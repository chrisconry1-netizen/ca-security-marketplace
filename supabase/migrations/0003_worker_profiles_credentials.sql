-- =====================================================================
-- 0003_worker_profiles_credentials.sql — Phase 2
-- Worker profile fields, seeded credential types, submit/review/expiry.
-- Non-destructive: additive columns, constraints, functions, and tighter
-- policies only. No tables, columns, or rows are dropped.
-- Workers can move a credential from unverified or rejected to pending.
-- verified / rejected are written only by public.review_credential, which
-- requires a moderator or admin and inserts credential_verifications.
-- Nothing in this migration contacts BSIS or any outside verifier.
-- =====================================================================

alter table public.worker_profiles
  add column if not exists security_experience text,
  add column if not exists le_experience_summary text;

alter table public.worker_profiles
  add constraint worker_profiles_security_experience_len
    check (security_experience is null or char_length(security_experience) <= 4000),
  add constraint worker_profiles_le_experience_len
    check (le_experience_summary is null or char_length(le_experience_summary) <= 2000),
  add constraint worker_profiles_le_summary_flag
    check (has_le_experience or le_experience_summary is null),
  add constraint worker_profiles_languages_card
    check (cardinality(languages) <= 20),
  add constraint worker_profiles_skills_card
    check (cardinality(skills) <= 30);

alter table public.credentials
  add column if not exists issuer text;

alter table public.credentials
  add constraint credentials_issuer_len
    check (issuer is null or char_length(btrim(issuer)) between 1 and 160),
  add constraint credentials_number_len
    check (credential_number is null or char_length(btrim(credential_number)) between 1 and 64);

-- issuer is worker-entered (the type's issuing_authority is only a hint).
revoke update on public.credentials from authenticated;
grant update (credential_number, issuer, issued_on, expires_on, document_path)
  on public.credentials to authenticated;

comment on column public.worker_profiles.security_experience is
  'Free-text security experience. Not a credential and not a verification.';
comment on column public.worker_profiles.le_experience_summary is
  'Optional context when has_le_experience is true. Not an LE verification and not authorization for off-duty work.';
comment on column public.credentials.issuer is
  'Issuer entered by the worker (for example CA BSIS or a training provider).';

-- ---------------------------------------------------------------------
-- Reference data. ON CONFLICT DO NOTHING so a re-apply cannot clobber edits.
-- ---------------------------------------------------------------------
insert into public.credential_types
  (code, name, issuing_authority, is_state_license, requires_document, has_expiration)
values
  ('ca_guard_registration', 'CA Guard Registration (BSIS)', 'CA BSIS', true, true, true),
  ('ca_exposed_firearm_permit', 'Exposed Firearm Permit', 'CA BSIS', true, true, true),
  ('ca_baton_permit', 'Baton Permit', 'CA BSIS', true, true, true),
  ('cpr_aed', 'CPR/AED', null, false, true, true),
  ('first_aid', 'First Aid', null, false, true, true),
  ('taser', 'Taser', null, false, true, true),
  ('oc', 'OC', null, false, true, true),
  ('ep_training', 'Executive Protection training', null, false, true, true),
  ('drivers_license', 'Driver''s license', null, true, true, true),
  ('other', 'Other', null, false, true, false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Path checks. Credential and avatar objects stay in the owner's folder.
-- ---------------------------------------------------------------------
create or replace function app.credential_document_path_ok(p_worker uuid, p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path is null
    or p_path ~ (
      '^' || p_worker::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpe?g|png|heic)$'
    )
$$;

create or replace function app.avatar_path_ok(p_user uuid, p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path is null
    or p_path ~ (
      '^' || p_user::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp)$'
    )
$$;

create or replace function app.pacific_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.timezone('America/Los_Angeles', pg_catalog.now()))::date
$$;

create or replace function app.try_inet(p text)
returns inet
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or btrim(p) = '' or p !~ '^[0-9A-Fa-f:.]+$' then
    return null;
  end if;
  return btrim(p)::inet;
exception when others then
  return null;
end
$$;

revoke all on function app.credential_document_path_ok(uuid, text) from public;
revoke all on function app.avatar_path_ok(uuid, text) from public;
revoke all on function app.pacific_today() from public;
revoke all on function app.try_inet(text) from public;
grant execute on function app.credential_document_path_ok(uuid, text) to authenticated, service_role;
grant execute on function app.avatar_path_ok(uuid, text) to authenticated, service_role;
grant execute on function app.pacific_today() to authenticated, service_role;
grant execute on function app.try_inet(text) to service_role;

-- ---------------------------------------------------------------------
-- Computed expiry. 'expired' wins for a past date on a live credential.
-- 'expiring_soon' is verified and due within 30 days (Pacific calendar).
-- This does not write status; public.mark_expired_credentials does that.
-- ---------------------------------------------------------------------
create or replace function public.credential_time_state(
  p_status public.verification_status,
  p_expires date
) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status = 'expired' then 'expired'
    when p_expires is not null
      and p_expires < app.pacific_today()
      and p_status in ('verified', 'pending', 'unverified') then 'expired'
    when p_expires is null then 'none'
    when p_status = 'verified' and p_expires <= app.pacific_today() + 30 then 'expiring_soon'
    else 'valid'
  end
$$;

revoke all on function public.credential_time_state(public.verification_status, date) from public, anon;
grant execute on function public.credential_time_state(public.verification_status, date) to authenticated, service_role;

comment on function public.credential_time_state(public.verification_status, date) is
  'Read-only expiry bucket: expired, expiring_soon (verified, 30 Pacific days), valid, or none.';

-- ---------------------------------------------------------------------
-- Row guards. Clients cannot change status. Privileged transitions set
-- app.credential_status_transition for the current transaction only.
-- ---------------------------------------------------------------------
create or replace function app.guard_credential_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_transition text := current_setting('app.credential_status_transition', true);
begin
  if not app.credential_document_path_ok(new.worker_id, new.document_path) then
    raise exception 'invalid document path' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'unverified' then
      raise exception 'new credentials start unverified' using errcode = '42501';
    end if;
    if new.last_verification_id is not null then
      raise exception 'new credentials have no verification' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.worker_id is distinct from old.worker_id
     or new.credential_type_id is distinct from old.credential_type_id then
    raise exception 'credential identity is immutable' using errcode = '42501';
  end if;

  if v_transition = 'submit' then
    if old.status not in ('unverified', 'rejected') or new.status is distinct from 'pending' then
      raise exception 'illegal submit transition' using errcode = '42501';
    end if;
    if new.credential_number is distinct from old.credential_number
       or new.issuer is distinct from old.issuer
       or new.issued_on is distinct from old.issued_on
       or new.expires_on is distinct from old.expires_on
       or new.document_path is distinct from old.document_path
       or new.last_verification_id is distinct from old.last_verification_id then
      raise exception 'submit cannot change credential fields' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_transition = 'verify' then
    if old.status is distinct from 'pending' or new.status not in ('verified', 'rejected') then
      raise exception 'illegal verification transition' using errcode = '42501';
    end if;
    if new.last_verification_id is null
       or new.credential_number is distinct from old.credential_number
       or new.issuer is distinct from old.issuer
       or new.issued_on is distinct from old.issued_on
       or new.expires_on is distinct from old.expires_on
       or new.document_path is distinct from old.document_path then
      raise exception 'verification cannot rewrite credential facts' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_transition = 'expire' then
    if new.status is distinct from 'expired' or old.status not in ('verified', 'pending', 'unverified') then
      raise exception 'illegal expiry transition' using errcode = '42501';
    end if;
    if old.expires_on is null or old.expires_on >= app.pacific_today() then
      raise exception 'credential is not past expiry' using errcode = '42501';
    end if;
    if new.credential_number is distinct from old.credential_number
       or new.issuer is distinct from old.issuer
       or new.issued_on is distinct from old.issued_on
       or new.expires_on is distinct from old.expires_on
       or new.document_path is distinct from old.document_path
       or new.last_verification_id is distinct from old.last_verification_id then
      raise exception 'expiry cannot rewrite credential facts' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.last_verification_id is distinct from old.last_verification_id then
    raise exception 'status is not client-writable' using errcode = '42501';
  end if;
  if old.status not in ('unverified', 'rejected') then
    raise exception 'credential is locked' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists credentials_guard_write on public.credentials;
create trigger credentials_guard_write
  before insert or update on public.credentials
  for each row execute function app.guard_credential_write();

create or replace function app.guard_profile_avatar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.avatar_path is distinct from old.avatar_path
     and not app.avatar_path_ok(new.id, new.avatar_path) then
    raise exception 'invalid avatar path' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists profiles_guard_avatar on public.profiles;
create trigger profiles_guard_avatar
  before update on public.profiles
  for each row execute function app.guard_profile_avatar();

revoke all on function app.guard_credential_write() from public;
revoke all on function app.guard_profile_avatar() from public;
grant execute on function app.guard_credential_write() to authenticated, service_role;
grant execute on function app.guard_profile_avatar() to authenticated, service_role;

-- Insert must stay unverified, and the document path must be the worker's.
drop policy if exists cred_owner_insert on public.credentials;
create policy cred_owner_insert on public.credentials
  for insert to authenticated
  with check (
    worker_id = (select auth.uid())
    and status = 'unverified'
    and app.credential_document_path_ok(worker_id, document_path)
  );

-- Pending, verified, and expired rows stay for the review record.
drop policy if exists cred_owner_delete on public.credentials;
create policy cred_owner_delete on public.credentials
  for delete to authenticated
  using (
    worker_id = (select auth.uid())
    and status in ('unverified', 'rejected')
  );

-- ---------------------------------------------------------------------
-- Worker submit. Rejected credentials can be submitted again after edits.
-- verified and rejected cannot be self-assigned here.
-- ---------------------------------------------------------------------
create or replace function public.submit_credential(
  p_credential_id uuid,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns public.verification_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_account public.account_status;
  v_cred_status public.verification_status;
  v_worker uuid;
  v_number text;
  v_issuer text;
  v_issued date;
  v_expires date;
  v_doc text;
  v_requires boolean;
  v_has_exp boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select status into v_account from public.profiles where id = v_uid;
  if v_account is null or v_account in ('suspended', 'deactivated') then
    raise exception 'account not active' using errcode = '42501';
  end if;

  select c.status, c.worker_id, c.credential_number, c.issuer, c.issued_on, c.expires_on, c.document_path,
         ct.requires_document, ct.has_expiration
    into v_cred_status, v_worker, v_number, v_issuer, v_issued, v_expires, v_doc, v_requires, v_has_exp
  from public.credentials c
  join public.credential_types ct on ct.id = c.credential_type_id
  where c.id = p_credential_id
  for update of c;

  if not found or v_worker is distinct from v_uid then
    raise exception 'credential not found' using errcode = '42501';
  end if;
  if v_cred_status not in ('unverified', 'rejected') then
    raise exception 'credential cannot be submitted' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(v_number, '')), '') is null then
    raise exception 'credential number required' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_issuer, '')), '') is null then
    raise exception 'issuer required' using errcode = '22023';
  end if;
  if v_issued is null then
    raise exception 'issue date required' using errcode = '22023';
  end if;
  if coalesce(v_has_exp, true) and v_expires is null then
    raise exception 'expiration date required' using errcode = '22023';
  end if;
  if v_doc is not null and not app.credential_document_path_ok(v_worker, v_doc) then
    raise exception 'invalid document path' using errcode = '42501';
  end if;
  if coalesce(v_requires, true) and v_doc is null then
    raise exception 'document required' using errcode = '22023';
  end if;

  perform set_config('app.credential_status_transition', 'submit', true);
  update public.credentials set status = 'pending' where id = p_credential_id;

  insert into public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent, request_id
  ) values (
    'user', v_uid, 'credential.submit', 'credential', p_credential_id,
    jsonb_build_object('status', v_cred_status),
    jsonb_build_object('status', 'pending'),
    app.try_inet(p_ip), left(p_user_agent, 512), left(p_request_id, 128)
  );
  return 'pending';
end
$$;

revoke all on function public.submit_credential(uuid, text, text, text) from public, anon;
grant execute on function public.submit_credential(uuid, text, text, text) to authenticated;

comment on function public.submit_credential(uuid, text, text, text) is
  'Owner-only transition to pending. Cannot set verified or rejected.';

-- ---------------------------------------------------------------------
-- Staff review. Inserts credential_verifications, then status.
-- Direct client writes to credential_verifications stay denied.
-- ---------------------------------------------------------------------
create or replace function public.review_credential(
  p_credential_id uuid,
  p_result public.verification_status,
  p_method text,
  p_source_reference text default null,
  p_notes text default null,
  p_valid_until date default null,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.platform_role;
  v_account public.account_status;
  v_old public.verification_status;
  v_worker uuid;
  v_expires date;
  v_id uuid;
  v_source text := nullif(btrim(coalesce(p_source_reference, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select platform_role, status into v_role, v_account from public.profiles where id = v_uid;
  if v_role is null or v_role not in ('moderator', 'admin', 'super_admin')
     or v_account in ('suspended', 'deactivated') then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_result not in ('verified', 'rejected') then
    raise exception 'result must be verified or rejected' using errcode = '22023';
  end if;
  if p_method not in ('bsis_public_lookup', 'document_review', 'issuer_contact', 'third_party_api', 'other') then
    raise exception 'invalid method' using errcode = '22023';
  end if;
  if p_result = 'verified' and v_source is null then
    raise exception 'source reference required' using errcode = '22023';
  end if;
  if p_result = 'rejected' and v_notes is null then
    raise exception 'rejection notes required' using errcode = '22023';
  end if;
  if v_source is not null and char_length(v_source) > 500 then
    raise exception 'source reference is too long' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 4000 then
    raise exception 'notes are too long' using errcode = '22023';
  end if;

  select status, worker_id, expires_on
    into v_old, v_worker, v_expires
  from public.credentials
  where id = p_credential_id
  for update;

  if not found then
    raise exception 'credential not found' using errcode = 'P0002';
  end if;
  if v_worker = v_uid then
    raise exception 'cannot review your own credential' using errcode = '42501';
  end if;
  if v_old is distinct from 'pending' then
    raise exception 'credential is not awaiting review' using errcode = '42501';
  end if;
  if p_result = 'verified' and v_expires is not null and v_expires < app.pacific_today() then
    raise exception 'cannot verify an expired credential' using errcode = '22023';
  end if;

  insert into public.credential_verifications (
    credential_id, result_status, method, source_reference, notes, verified_by, valid_until
  ) values (
    p_credential_id, p_result, p_method, v_source, v_notes, v_uid, p_valid_until
  ) returning id into v_id;

  perform set_config('app.credential_status_transition', 'verify', true);
  update public.credentials
     set status = p_result,
         last_verification_id = v_id
   where id = p_credential_id;

  insert into public.admin_actions (admin_id, action, target_type, target_id, reason, confirmed_at, metadata)
  values (
    v_uid,
    case when p_result = 'verified' then 'verify_credential' else 'reject_credential' end,
    'credential',
    p_credential_id,
    coalesce(v_notes, v_source, p_method),
    pg_catalog.now(),
    jsonb_build_object('method', p_method, 'result', p_result, 'verification_id', v_id)
  );

  insert into public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent, request_id
  ) values (
    'admin', v_uid, 'credential.review', 'credential', p_credential_id,
    jsonb_build_object('status', v_old),
    jsonb_build_object('status', p_result, 'verification_id', v_id, 'method', p_method),
    app.try_inet(p_ip), left(p_user_agent, 512), left(p_request_id, 128)
  );

  insert into public.notifications (user_id, event_type, title, body, link_path, data)
  values (
    v_worker,
    case when p_result = 'verified' then 'credential_verified' else 'credential_rejected' end,
    case when p_result = 'verified' then 'Credential verified' else 'Credential needs attention' end,
    case when p_result = 'verified'
      then 'A moderator verified one of your credentials.'
      else 'A moderator could not verify one of your credentials. You can update it and submit it again.'
    end,
    '/worker/credentials/' || p_credential_id::text,
    jsonb_build_object('credential_id', p_credential_id, 'status', p_result)
  );

  return v_id;
end
$$;

revoke all on function public.review_credential(uuid, public.verification_status, text, text, text, date, text, text, text) from public, anon;
grant execute on function public.review_credential(uuid, public.verification_status, text, text, text, date, text, text, text) to authenticated;

comment on function public.review_credential(uuid, public.verification_status, text, text, text, date, text, text, text) is
  'Staff-only human review. Writes credential_verifications and audit_logs. Does not call an external registry.';

-- ---------------------------------------------------------------------
-- Scheduled-ready expiry sweep. In-app notifications only — no email,
-- no SMS, no provider call. Grant is service_role; JWT role is checked
-- so a stolen execute grant still cannot be used by a signed-in user.
-- ---------------------------------------------------------------------
create or replace function public.mark_expired_credentials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
  v_today date := app.pacific_today();
  v_count integer := 0;
  r record;
begin
  if v_role is not null and v_role <> 'service_role' then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  for r in
    select c.id, c.worker_id, c.status, c.expires_on, t.name as type_name
    from public.credentials c
    join public.credential_types t on t.id = c.credential_type_id
    where c.expires_on is not null
      and c.expires_on < v_today
      and c.status in ('verified', 'pending', 'unverified')
    order by c.id
    for update of c
  loop
    perform set_config('app.credential_status_transition', 'expire', true);
    update public.credentials set status = 'expired' where id = r.id;

    insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, before_data, after_data)
    values (
      'system', null, 'credential.expired', 'credential', r.id,
      jsonb_build_object('status', r.status, 'expires_on', r.expires_on),
      jsonb_build_object('status', 'expired')
    );

    insert into public.notifications (user_id, event_type, title, body, link_path, data)
    select r.worker_id, 'credential_expired', 'Credential expired',
           r.type_name || ' is past its expiration date.',
           '/worker/credentials/' || r.id::text,
           jsonb_build_object('credential_id', r.id, 'expires_on', r.expires_on)
    where not exists (
      select 1 from public.notifications n
      where n.user_id = r.worker_id
        and n.event_type = 'credential_expired'
        and n.data ->> 'credential_id' = r.id::text
        and n.data ->> 'expires_on' = r.expires_on::text
    );
    v_count := v_count + 1;
  end loop;

  insert into public.notifications (user_id, event_type, title, body, link_path, data)
  select c.worker_id, 'credential_expiring', 'Credential expiring soon',
         t.name || ' expires within 30 days.',
         '/worker/credentials/' || c.id::text,
         jsonb_build_object('credential_id', c.id, 'expires_on', c.expires_on)
  from public.credentials c
  join public.credential_types t on t.id = c.credential_type_id
  where c.status = 'verified'
    and c.expires_on is not null
    and c.expires_on >= v_today
    and c.expires_on <= v_today + 30
    and not exists (
      select 1 from public.notifications n
      where n.user_id = c.worker_id
        and n.event_type = 'credential_expiring'
        and n.data ->> 'credential_id' = c.id::text
        and n.data ->> 'expires_on' = c.expires_on::text
    );

  return v_count;
end
$$;

revoke all on function public.mark_expired_credentials() from public, anon, authenticated;
grant execute on function public.mark_expired_credentials() to service_role;

comment on function public.mark_expired_credentials() is
  'Marks past-due credentials expired and writes in-app notifications. Does not send email or SMS. Call from a scheduler with service_role.';

create index if not exists credentials_pending_idx
  on public.credentials (created_at)
  where status = 'pending';

create index if not exists notifications_credential_event_idx
  on public.notifications ((data ->> 'credential_id'), event_type);
