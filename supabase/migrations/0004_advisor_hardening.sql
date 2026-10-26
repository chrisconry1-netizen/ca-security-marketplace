-- =====================================================================
-- 0004_advisor_hardening.sql — Supabase advisor follow-ups
-- Non-destructive:
--   * fixed search_path on trigger helpers that were missing it
--   * RLS/storage policies rewritten so auth.uid() is (select auth.uid())
--     (same predicate, initplan form). No privilege is added.
--   * indexes on foreign keys that had none
--   * execute revoked from anon/authenticated on trigger-only functions
-- Helper functions used by policies also read (select auth.uid()) so a
-- SQL inlining pass cannot reintroduce a per-row auth.uid() call.
-- Credential policies tightened in 0003 are left as written there.
-- =====================================================================

create or replace function app.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only';
end
$$;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create or replace function app.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end
$$;

create or replace function app.current_platform_role()
returns public.platform_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.platform_role from public.profiles p where p.id = (select auth.uid())
$$;

create or replace function app.is_org_member(p_org uuid, p_roles public.org_member_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and (p_roles is null or m.role = any (p_roles))
  )
$$;

create or replace function app.is_conversation_member(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conv
      and cm.user_id = (select auth.uid())
  )
$$;

-- Trigger-only definers. supabase_auth_admin fires the auth.users triggers.
revoke all on function app.handle_new_user() from public, anon, authenticated;
revoke all on function app.sync_user_email() from public, anon, authenticated;
grant execute on function app.handle_new_user() to supabase_auth_admin;
grant execute on function app.sync_user_email() to supabase_auth_admin;

revoke all on function app.audit_logs_immutable() from public, anon, authenticated;
grant execute on function app.audit_logs_immutable() to service_role;

-- set_updated_at and try_uuid stay executable by signed-in roles: user updates
-- fire the trigger, and storage policies call try_uuid.
grant execute on function app.set_updated_at() to anon, authenticated, service_role;
grant execute on function app.try_uuid(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Policies. Predicates match 0000/0001/0002 except auth.uid() wrapping
-- and the credential insert/delete rules already replaced in 0003.
-- ---------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or app.is_staff());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists wp_owner_read on public.worker_profiles;
create policy wp_owner_read on public.worker_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists wp_owner_update on public.worker_profiles;
create policy wp_owner_update on public.worker_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists wp_employer_read on public.worker_profiles;
create policy wp_employer_read on public.worker_profiles
  for select to authenticated
  using (
    is_searchable
    and exists (
      select 1 from public.organization_members m
      where m.user_id = (select auth.uid())
    )
  );

drop policy if exists ep_owner_read on public.employer_profiles;
create policy ep_owner_read on public.employer_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ep_owner_update on public.employer_profiles;
create policy ep_owner_update on public.employer_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists cred_owner_read on public.credentials;
create policy cred_owner_read on public.credentials
  for select to authenticated
  using (worker_id = (select auth.uid()) or app.is_staff());

drop policy if exists cred_owner_update on public.credentials;
create policy cred_owner_update on public.credentials
  for update to authenticated
  using (worker_id = (select auth.uid()))
  with check (worker_id = (select auth.uid()));

drop policy if exists cv_read on public.credential_verifications;
create policy cv_read on public.credential_verifications
  for select to authenticated
  using (
    app.is_staff()
    or exists (
      select 1 from public.credentials c
      where c.id = credential_id
        and c.worker_id = (select auth.uid())
    )
  );

drop policy if exists le_owner_read on public.le_officer_profiles;
create policy le_owner_read on public.le_officer_profiles
  for select to authenticated
  using (worker_id = (select auth.uid()) or app.is_staff());

drop policy if exists le_owner_insert on public.le_officer_profiles;
create policy le_owner_insert on public.le_officer_profiles
  for insert to authenticated
  with check (worker_id = (select auth.uid()) and status = 'identity_unverified');

drop policy if exists wa_owner_all on public.worker_availability;
create policy wa_owner_all on public.worker_availability
  for all to authenticated
  using (worker_id = (select auth.uid()))
  with check (worker_id = (select auth.uid()));

drop policy if exists app_worker_read on public.applications;
create policy app_worker_read on public.applications
  for select to authenticated
  using (worker_id = (select auth.uid()));

drop policy if exists app_worker_insert on public.applications;
create policy app_worker_insert on public.applications
  for insert to authenticated
  with check (
    worker_id = (select auth.uid())
    and status = 'submitted'
    and exists (
      select 1 from public.jobs j
      where j.id = job_id and j.status = 'published'
    )
  );

drop policy if exists asg_read on public.assignments;
create policy asg_read on public.assignments
  for select to authenticated
  using (
    worker_id = (select auth.uid())
    or app.is_org_member(organization_id)
    or app.is_staff()
  );

drop policy if exists cm_self_update on public.conversation_members;
create policy cm_self_update on public.conversation_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists msg_member_insert on public.messages;
create policy msg_member_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and kind in ('text', 'job_card', 'attachment')
    and app.is_conversation_member(conversation_id)
    and not exists (
      select 1
      from public.conversation_members o
      join public.user_blocks b
        on b.blocker_id = o.user_id
       and b.blocked_id = (select auth.uid())
      where o.conversation_id = messages.conversation_id
    )
  );

drop policy if exists ub_owner_all on public.user_blocks;
create policy ub_owner_all on public.user_blocks
  for all to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

drop policy if exists notif_owner_read on public.notifications;
create policy notif_owner_read on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notif_owner_update on public.notifications;
create policy notif_owner_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists np_owner_all on public.notification_preferences;
create policy np_owner_all on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists sj_owner_all on public.saved_jobs;
create policy sj_owner_all on public.saved_jobs
  for all to authenticated
  using (worker_id = (select auth.uid()))
  with check (worker_id = (select auth.uid()));

drop policy if exists rev_public_read on public.reviews;
create policy rev_public_read on public.reviews
  for select to authenticated
  using (status = 'published' or reviewer_id = (select auth.uid()) or app.is_staff());

drop policy if exists rep_insert on public.reports;
create policy rep_insert on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open');

drop policy if exists rep_read on public.reports;
create policy rep_read on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or app.is_staff());

drop policy if exists subs_org_read on public.subscriptions;
create policy subs_org_read on public.subscriptions
  for select to authenticated
  using (
    app.is_org_member(organization_id, array['owner_admin']::public.org_member_role[])
    or user_id = (select auth.uid())
    or app.is_admin()
  );

drop policy if exists ai_owner_read on public.ai_tool_calls;
create policy ai_owner_read on public.ai_tool_calls
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_admin());

drop policy if exists api_owner_read on public.api_clients;
create policy api_owner_read on public.api_clients
  for select to authenticated
  using (owner_user_id = (select auth.uid()) or app.is_admin());

drop policy if exists avatars_owner_select on storage.objects;
create policy avatars_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists creddocs_owner_select on storage.objects;
create policy creddocs_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'credential-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists creddocs_owner_insert on storage.objects;
create policy creddocs_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'credential-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.account_type = 'worker'
    )
  );

drop policy if exists ledocs_owner_select on storage.objects;
create policy ledocs_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'le-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists ledocs_owner_insert on storage.objects;
create policy ledocs_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'le-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.account_type = 'worker'
    )
  );

drop policy if exists msgatt_member_insert on storage.objects;
create policy msgatt_member_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and app.is_conversation_member(app.try_uuid((storage.foldername(name))[1]))
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------
-- Foreign keys that were not the leading column of an index.
-- ---------------------------------------------------------------------
create index if not exists organizations_created_by_idx on public.organizations (created_by);
create index if not exists organization_members_invited_by_idx on public.organization_members (invited_by);
create index if not exists employer_profiles_primary_organization_id_idx on public.employer_profiles (primary_organization_id);
create index if not exists credentials_last_verification_id_idx on public.credentials (last_verification_id);
create index if not exists credential_verifications_verified_by_idx on public.credential_verifications (verified_by);
create index if not exists le_officer_profiles_reviewed_by_idx on public.le_officer_profiles (reviewed_by);
create index if not exists jobs_created_by_idx on public.jobs (created_by);
create index if not exists job_requirements_credential_type_id_idx on public.job_requirements (credential_type_id);
create index if not exists conversations_organization_id_idx on public.conversations (organization_id);
create index if not exists conversations_job_id_idx on public.conversations (job_id);
create index if not exists conversations_application_id_idx on public.conversations (application_id);
create index if not exists conversations_created_by_idx on public.conversations (created_by);
create index if not exists messages_job_id_idx on public.messages (job_id);
create index if not exists message_attachments_conversation_id_idx on public.message_attachments (conversation_id);
create index if not exists user_blocks_blocked_id_idx on public.user_blocks (blocked_id);
create index if not exists saved_jobs_job_id_idx on public.saved_jobs (job_id);
create index if not exists saved_workers_worker_id_idx on public.saved_workers (worker_id);
create index if not exists saved_workers_saved_by_idx on public.saved_workers (saved_by);
create index if not exists reviews_reviewer_id_idx on public.reviews (reviewer_id);
create index if not exists reviews_reviewee_user_id_idx on public.reviews (reviewee_user_id);
create index if not exists reviews_reviewee_org_id_idx on public.reviews (reviewee_org_id);
create index if not exists reports_reporter_id_idx on public.reports (reporter_id);
create index if not exists reports_assigned_to_idx on public.reports (assigned_to);
create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index if not exists payments_subscription_id_idx on public.payments (subscription_id);
create index if not exists api_clients_owner_user_id_idx on public.api_clients (owner_user_id);
-- The existing unread index is partial (read_at is null) and does not cover
-- the foreign key for rows that have been read.
create index if not exists notifications_user_id_idx on public.notifications (user_id);

do $$
declare
  missing text;
begin
  select string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ' order by c.conname)
    into missing
  from pg_constraint c
  where c.contype = 'f'
    and c.connamespace = 'public'::regnamespace
    and not exists (
      select 1
      from pg_index i
      where i.indrelid = c.conrelid
        and i.indisvalid
        and i.indpred is null
        and (string_to_array(i.indkey::text, ' ')::smallint[])[1:array_length(c.conkey, 1)] = c.conkey
    );
  if missing is not null then
    raise exception 'unindexed foreign keys remain: %', missing;
  end if;
end
$$;
