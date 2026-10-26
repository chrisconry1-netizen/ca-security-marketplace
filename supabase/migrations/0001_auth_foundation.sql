-- =====================================================================
-- 0001_auth_foundation.sql — Phase 1: authentication foundation
--  * profile auto-provisioning from auth.users (trigger)
--  * one-time account type selection (worker | employer) via RPC
--  * effective role resolution (public.my_roles)
--  * audit-log framework: append-only table (0000) + whitelisted client RPC
--  * hardening: worker/employer profile rows can only be created by the RPC
-- Non-destructive: no drops of tables/columns/data.
-- =====================================================================

-- account_type is chosen AFTER sign-up (account-type step), so it starts null.
alter table public.profiles alter column account_type drop not null;
alter table public.profiles add column if not exists onboarding_completed_at timestamptz;

-- ---------------------------------------------------------------------
-- Profile provisioning. Never trusts client metadata for role/type.
-- ---------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  v_name := left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
                          nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                          'New user'), 80);
  insert into public.profiles (id, display_name, email)
  values (new.id, v_name, new.email)
  on conflict (id) do nothing;
  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id)
  values ('system', new.id, 'auth.user_created', 'profile', new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create or replace function app.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
    insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id)
    values ('system', new.id, 'auth.email_changed', 'profile', new.id);
  end if;
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id)
    values ('system', new.id, 'auth.email_verified', 'profile', new.id);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update of email, email_confirmed_at on auth.users
  for each row execute function app.sync_user_email();

-- ---------------------------------------------------------------------
-- Worker / employer profile rows: created only by select_account_type().
-- Replace the 0000 "for all" owner policies with select/update only.
-- ---------------------------------------------------------------------
drop policy if exists wp_owner_all on public.worker_profiles;
create policy wp_owner_read   on public.worker_profiles for select to authenticated using (user_id = auth.uid());
create policy wp_owner_update on public.worker_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ep_owner_all on public.employer_profiles;
create policy ep_owner_read   on public.employer_profiles for select to authenticated using (user_id = auth.uid());
create policy ep_owner_update on public.employer_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- employers may not self-assign an organization; membership is created by server routes.
revoke update on public.employer_profiles from authenticated;
grant update (job_title) on public.employer_profiles to authenticated;

-- ---------------------------------------------------------------------
-- One-time account type selection
-- ---------------------------------------------------------------------
create or replace function public.select_account_type(p_account_type public.account_type)
returns public.account_type
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_cur public.account_type; v_status public.account_status;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_account_type is null or p_account_type not in ('worker', 'employer') then
    raise exception 'invalid account type' using errcode = '22023';
  end if;
  select account_type, status into v_cur, v_status from public.profiles where id = v_uid for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  if v_status in ('suspended', 'deactivated') then raise exception 'account not active' using errcode = '42501'; end if;
  if v_cur is not null then
    if v_cur = p_account_type then return v_cur; end if;   -- idempotent
    raise exception 'account type already set' using errcode = '42501';
  end if;

  update public.profiles set account_type = p_account_type where id = v_uid;
  if p_account_type = 'worker' then
    insert into public.worker_profiles (user_id) values (v_uid) on conflict do nothing;
  else
    insert into public.employer_profiles (user_id) values (v_uid) on conflict do nothing;
  end if;
  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  values ('user', v_uid, 'account.type_selected', 'profile', v_uid, jsonb_build_object('account_type', p_account_type));
  return p_account_type;
end $$;
revoke all on function public.select_account_type(public.account_type) from public, anon;
grant execute on function public.select_account_type(public.account_type) to authenticated;

-- ---------------------------------------------------------------------
-- Effective roles: worker, employer, organization_admin, organization_manager,
-- organization_recruiter, moderator, admin, super_admin.
-- Informational for UI + server guards; RLS never relies on this array.
-- ---------------------------------------------------------------------
create or replace function public.my_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct r order by r), '{}'::text[]) from (
    select p.account_type::text as r from public.profiles p
      where p.id = auth.uid() and p.account_type in ('worker', 'employer')
    union all
    select p.platform_role::text from public.profiles p
      where p.id = auth.uid() and p.platform_role <> 'user'
    union all
    select case m.role when 'owner_admin' then 'organization_admin'
                       when 'manager' then 'organization_manager'
                       else 'organization_recruiter' end
      from public.organization_members m where m.user_id = auth.uid()
  ) s
$$;
revoke all on function public.my_roles() from public, anon;
grant execute on function public.my_roles() to authenticated;

-- ---------------------------------------------------------------------
-- Audit framework, client side: a user may record ONLY whitelisted auth
-- events about THEMSELVES. actor_id is forced to auth.uid(). Throttled.
-- Privileged events are written by server code with service_role.
-- ---------------------------------------------------------------------
create or replace function public.record_auth_event(p_action text, p_user_agent text default null, p_request_id text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_recent int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_action not in ('auth.login', 'auth.logout', 'auth.password_updated') then
    raise exception 'action not permitted' using errcode = '42501';
  end if;
  select count(*) into v_recent from public.audit_logs
    where actor_id = v_uid and occurred_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'rate limited' using errcode = '54000'; end if;
  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, user_agent, request_id)
  values ('user', v_uid, p_action, 'auth_session', v_uid, left(p_user_agent, 512), left(p_request_id, 128));
end $$;
revoke all on function public.record_auth_event(text, text, text) from public, anon;
grant execute on function public.record_auth_event(text, text, text) to authenticated;

-- Clients never write audit_logs directly (service_role / definer functions only).
revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;
create index if not exists audit_logs_action_idx on public.audit_logs(action, occurred_at desc);
