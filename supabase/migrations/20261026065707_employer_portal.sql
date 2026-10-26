-- =====================================================================
-- Phase 3 — employer organizations, membership, and jobs.
-- Additive. No drops of tables or columns. RLS is tightened, not opened:
--   * employers lose SELECT on worker_profiles (minimized card table instead)
--   * organization_members writes move to security-definer RPCs
--   * job status and organization verification are trigger-gated
--   * jobs.site_address_private cannot be written; street addresses live
--     in job_private_locations
-- The six multiple-permissive SELECT policies reported by the local
-- advisor are collapsed to one policy per role and action. Predicates
-- for the kept access paths are the same OR as before, except the
-- employer read of worker_profiles, which is removed on purpose.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Minimized searchable-worker projection.
-- Columns are the whole contract: bio, narrative experience, law-
-- enforcement text, postal code, and coordinates are not stored.
-- ---------------------------------------------------------------------
create table public.worker_search_cards (
  user_id               uuid primary key references public.worker_profiles(user_id) on delete cascade,
  display_name          text not null,
  headline              text,
  city                  text,
  county                text,
  work_radius_miles     integer,
  years_experience      smallint,
  preferred_categories  public.security_category[] not null default '{}',
  min_hourly_rate_cents integer,
  has_transportation    boolean,
  languages             text[] not null default '{}',
  skills                text[] not null default '{}',
  updated_at            timestamptz not null default now()
);

comment on table public.worker_search_cards is
  'Employer-facing projection of workers who opted in. Maintained by trigger from worker_profiles. Does not contain bio, security narrative, law-enforcement text, postal code, coordinates, phone, or email.';

create table public.job_private_locations (
  job_id       uuid primary key references public.jobs(id) on delete cascade,
  site_address text not null check (char_length(btrim(site_address)) between 1 and 300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.job_private_locations is
  'Street address for a job. Readable by that organization, staff, applicants, and assigned workers. Not part of the public job row.';

comment on column public.jobs.site_address_private is
  'Retired for writes in Phase 3. Street addresses are stored in job_private_locations.';

create table public.organization_invites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  email            public.citext not null,
  role             public.org_member_role not null,
  token_hash       text not null unique,
  invited_by       uuid references public.profiles(id) on delete set null,
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid references public.profiles(id) on delete set null,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (accepted_at is null or revoked_at is null)
);

comment on table public.organization_invites is
  'In-app organization invites. token_hash is sha256 of the secret. No email or SMS is sent.';

create index organization_invites_organization_id_idx on public.organization_invites (organization_id);
create index organization_invites_invited_by_idx on public.organization_invites (invited_by);
create index organization_invites_accepted_by_idx on public.organization_invites (accepted_by);
create unique index organization_invites_open_email_idx
  on public.organization_invites (organization_id, email)
  where accepted_at is null and revoked_at is null;

create trigger organization_invites_set_updated_at
  before update on public.organization_invites
  for each row execute function app.set_updated_at();
create trigger job_private_locations_set_updated_at
  before update on public.job_private_locations
  for each row execute function app.set_updated_at();
create trigger worker_search_cards_set_updated_at
  before update on public.worker_search_cards
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function app.sha256_hex(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_text, 'utf8'), 'sha256'), 'hex')
$$;

create or replace function app.clean_counties(p_counties text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(btrim(c) order by ord)
     from unnest(coalesce(p_counties, '{}'::text[])) with ordinality as u(c, ord)
     where btrim(coalesce(c, '')) <> ''),
    '{}'::text[]
  )
$$;

create or replace function app.counties_ok(p_counties text[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  c text;
begin
  if p_counties is null then
    return true;
  end if;
  if cardinality(p_counties) > 40 then
    return false;
  end if;
  foreach c in array p_counties loop
    if c is null or char_length(btrim(c)) < 1 or char_length(c) > 80 or c ~ '[[:cntrl:]]' then
      return false;
    end if;
  end loop;
  return true;
end
$$;

create or replace function app.org_logo_path_ok(p_org uuid, p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path is null
    or p_path ~ ('^' || p_org::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$')
$$;

create or replace function app.org_verification_ok(
  p_from public.verification_status,
  p_to public.verification_status
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from in ('unverified', 'rejected', 'expired') and p_to = 'pending')
      or (p_from = 'pending' and p_to in ('verified', 'rejected'))
      or (p_from in ('pending', 'verified') and p_to = 'unverified')
$$;

create or replace function app.job_transition_ok(
  p_from public.job_status,
  p_to public.job_status,
  p_org_verified boolean
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = 'draft' and p_to = 'pending_review' then true
    when p_from = 'draft' and p_to = 'published' then coalesce(p_org_verified, false)
    when p_from = 'draft' and p_to = 'cancelled' then true
    when p_from = 'pending_review' and p_to = 'draft' then true
    when p_from = 'pending_review' and p_to = 'published' then coalesce(p_org_verified, false)
    when p_from = 'pending_review' and p_to = 'cancelled' then true
    when p_from = 'published' and p_to in ('filled', 'in_progress', 'cancelled', 'expired') then true
    when p_from = 'filled' and p_to in ('in_progress', 'cancelled') then true
    when p_from = 'in_progress' and p_to in ('completed', 'cancelled') then true
    else false
  end
$$;

create or replace function app.job_post_complete(p public.jobs)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_days text[];
begin
  if p.title is null or char_length(btrim(p.title)) < 3 then return false; end if;
  if p.description is null or char_length(btrim(p.description)) < 20 then return false; end if;
  if p.city is null or char_length(btrim(p.city)) < 2 or char_length(p.city) > 80 then return false; end if;
  if p.city ~* '\m(street|avenue|boulevard|highway|drive|lane|court|place|terrace|circle|road)\M'
     or p.city ~ '^\s*[0-9]' then
    return false;
  end if;
  if p.county is not null and (
    char_length(p.county) > 80
    or p.county ~* '\m(street|avenue|boulevard|highway|drive|lane|court|place|terrace|circle|road)\M'
    or p.county ~ '^\s*[0-9]'
  ) then
    return false;
  end if;
  if p.postal_code is not null and p.postal_code !~ '^\d{5}(-\d{4})?$' then return false; end if;
  if p.pay_min_cents is null or p.pay_min_cents < 0 then return false; end if;
  if p.pay_type not in ('hourly', 'flat', 'estimated') then return false; end if;
  if p.pay_type = 'flat' and p.pay_max_cents is not null then return false; end if;
  if p.pay_type in ('hourly', 'estimated') and p.pay_max_cents is not null and p.pay_max_cents < p.pay_min_cents then
    return false;
  end if;
  if p.workers_needed is null or p.workers_needed < 1 then return false; end if;
  if p.job_type in ('single_shift', 'multi_day')
     and (p.starts_at is null or p.ends_at is null or p.ends_at <= p.starts_at) then
    return false;
  end if;
  if p.job_type = 'single_shift' and p.ends_at > p.starts_at + interval '36 hours' then
    return false;
  end if;
  if p.job_type = 'recurring' then
    if p.starts_at is null or p.recurrence_rule is null then return false; end if;
    if p.recurrence_rule !~ '^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*$' then
      return false;
    end if;
    v_days := string_to_array(split_part(p.recurrence_rule, 'BYDAY=', 2), ',');
    if (select count(*) from unnest(v_days) d) <> (select count(distinct d) from unnest(v_days) d) then
      return false;
    end if;
  end if;
  if p.job_type in ('contract', 'part_time', 'full_time') then
    if (p.starts_at is null) <> (p.ends_at is null) then return false; end if;
    if p.starts_at is not null and p.ends_at <= p.starts_at then return false; end if;
  end if;
  return true;
end
$$;

create or replace function app.write_audit(
  p_actor_type public.actor_type,
  p_actor uuid,
  p_org uuid,
  p_action text,
  p_entity_type text,
  p_entity uuid,
  p_before jsonb,
  p_after jsonb,
  p_ip text,
  p_ua text,
  p_request text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    actor_type, actor_id, organization_id, action, entity_type, entity_id,
    before_data, after_data, ip_address, user_agent, request_id
  ) values (
    p_actor_type, p_actor, p_org, p_action, p_entity_type, p_entity,
    p_before, p_after,
    app.try_inet(p_ip), left(p_ua, 512), left(p_request, 128)
  );
end
$$;

-- ---------------------------------------------------------------------
-- Organization + job guards
-- ---------------------------------------------------------------------
create or replace function app.guard_organization_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.verification_status is distinct from 'unverified' or new.verified_at is not null then
      raise exception 'new organizations start unverified' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.created_by is distinct from old.created_by
       or new.stripe_customer_id is distinct from old.stripe_customer_id then
      raise exception 'organization identity is immutable' using errcode = '42501';
    end if;
    if new.verification_status is distinct from old.verification_status
       or new.verified_at is distinct from old.verified_at then
      if current_setting('app.org_verification_transition', true) is distinct from '1' then
        raise exception 'verification status is not client-writable' using errcode = '42501';
      end if;
      if new.verification_status is distinct from old.verification_status
         and not app.org_verification_ok(old.verification_status, new.verification_status) then
        raise exception 'illegal verification transition' using errcode = '42501';
      end if;
      if new.verification_status = 'verified' and new.verified_at is null then
        raise exception 'verified_at required' using errcode = '22023';
      end if;
      if new.verification_status is distinct from 'verified' and new.verified_at is not null then
        raise exception 'verified_at must be empty' using errcode = '22023';
      end if;
    end if;
  end if;

  if not app.org_logo_path_ok(new.id, new.logo_path) then
    raise exception 'invalid logo path' using errcode = '42501';
  end if;
  if not app.counties_ok(new.service_counties) then
    raise exception 'invalid service area' using errcode = '22023';
  end if;
  if new.contact_phone_e164 is not null and new.contact_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid phone' using errcode = '22023';
  end if;
  if new.website is not null and (char_length(new.website) > 200 or new.website !~ '^https://[^[:space:]]+$') then
    raise exception 'invalid website' using errcode = '22023';
  end if;
  if new.contact_email is not null and (
    char_length(new.contact_email::text) > 200
    or new.contact_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if new.bsis_license_number is not null and char_length(new.bsis_license_number) > 40 then
    raise exception 'invalid license' using errcode = '22023';
  end if;
  if new.bsis_license_type is not null and char_length(new.bsis_license_type) > 80 then
    raise exception 'invalid license' using errcode = '22023';
  end if;
  if new.description is not null and char_length(new.description) > 5000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return new;
end
$$;

drop trigger if exists organizations_guard_write on public.organizations;
create trigger organizations_guard_write
  before insert or update on public.organizations
  for each row execute function app.guard_organization_write();

create or replace function app.guard_job_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_verified boolean;
begin
  if new.site_address_private is not null then
    raise exception 'use job_private_locations' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' or new.published_at is not null then
      raise exception 'new jobs start as drafts' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by then
    raise exception 'job identity is immutable' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if current_setting('app.job_status_transition', true) is distinct from '1' then
      raise exception 'status is server-managed' using errcode = '42501';
    end if;
    select o.verification_status = 'verified' into v_verified
    from public.organizations o
    where o.id = new.organization_id;
    if not app.job_transition_ok(old.status, new.status, coalesce(v_verified, false)) then
      raise exception 'illegal job transition' using errcode = '42501';
    end if;
    if new.status in ('pending_review', 'published') and not app.job_post_complete(new) then
      raise exception 'job is incomplete' using errcode = '22023';
    end if;
    if new.status = 'published' and old.status is distinct from 'published' and new.published_at is null then
      new.published_at := pg_catalog.now();
    end if;
  end if;

  if new.published_at is distinct from old.published_at
     and not (new.status = 'published' and old.status is distinct from 'published') then
    raise exception 'published_at is server-managed' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists jobs_guard_write on public.jobs;
create trigger jobs_guard_write
  before insert or update on public.jobs
  for each row execute function app.guard_job_write();

create or replace function app.allow_org_member_cascade()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.org_delete', '1', true);
  return old;
end
$$;

drop trigger if exists organizations_before_delete on public.organizations;
create trigger organizations_before_delete
  before delete on public.organizations
  for each row execute function app.allow_org_member_cascade();

create or replace function app.guard_org_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owners integer;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.user_id is distinct from old.user_id then
      raise exception 'membership identity is immutable' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' and current_setting('app.org_delete', true) = '1' then
    return old;
  end if;

  if (tg_op = 'DELETE' and old.role = 'owner_admin')
     or (tg_op = 'UPDATE' and old.role = 'owner_admin' and new.role is distinct from 'owner_admin') then
    perform 1
    from public.organization_members
    where organization_id = old.organization_id
      and role = 'owner_admin'
    for update;
    select count(*) into v_owners
    from public.organization_members
    where organization_id = old.organization_id
      and role = 'owner_admin';
    if v_owners < 2 then
      raise exception 'last owner' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

drop trigger if exists organization_members_guard on public.organization_members;
create trigger organization_members_guard
  before update or delete on public.organization_members
  for each row execute function app.guard_org_member();

-- ---------------------------------------------------------------------
-- Worker card sync. Security definer so the owner can write a table
-- clients cannot write. The column list is the minimization.
-- ---------------------------------------------------------------------
create or replace function app.sync_worker_search_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'DELETE' or not coalesce(new.is_searchable, false) then
    delete from public.worker_search_cards
    where user_id = coalesce(new.user_id, old.user_id);
    return coalesce(new, old);
  end if;

  select p.display_name into v_name from public.profiles p where p.id = new.user_id;
  if v_name is null then
    return new;
  end if;

  insert into public.worker_search_cards (
    user_id, display_name, headline, city, county, work_radius_miles, years_experience,
    preferred_categories, min_hourly_rate_cents, has_transportation, languages, skills
  ) values (
    new.user_id, v_name, new.headline, new.city, new.county, new.work_radius_miles, new.years_experience,
    new.preferred_categories, new.min_hourly_rate_cents, new.has_transportation, new.languages, new.skills
  )
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    headline = excluded.headline,
    city = excluded.city,
    county = excluded.county,
    work_radius_miles = excluded.work_radius_miles,
    years_experience = excluded.years_experience,
    preferred_categories = excluded.preferred_categories,
    min_hourly_rate_cents = excluded.min_hourly_rate_cents,
    has_transportation = excluded.has_transportation,
    languages = excluded.languages,
    skills = excluded.skills;
  return new;
end
$$;

drop trigger if exists worker_profiles_sync_card on public.worker_profiles;
create trigger worker_profiles_sync_card
  after insert or update or delete on public.worker_profiles
  for each row execute function app.sync_worker_search_card();

create or replace function app.sync_worker_card_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name is distinct from old.display_name then
    update public.worker_search_cards
       set display_name = new.display_name
     where user_id = new.id;
  end if;
  return new;
end
$$;

drop trigger if exists profiles_sync_worker_card_name on public.profiles;
create trigger profiles_sync_worker_card_name
  after update of display_name on public.profiles
  for each row execute function app.sync_worker_card_name();

insert into public.worker_search_cards (
  user_id, display_name, headline, city, county, work_radius_miles, years_experience,
  preferred_categories, min_hourly_rate_cents, has_transportation, languages, skills
)
select wp.user_id, p.display_name, wp.headline, wp.city, wp.county, wp.work_radius_miles, wp.years_experience,
       wp.preferred_categories, wp.min_hourly_rate_cents, wp.has_transportation, wp.languages, wp.skills
from public.worker_profiles wp
join public.profiles p on p.id = wp.user_id
where wp.is_searchable
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- Column privileges. Status and verification stay off the client grant.
-- ---------------------------------------------------------------------
grant update (org_type) on public.organizations to authenticated;

-- License text is shown to members and staff as submitted. It is not part of
-- the row any signed-in user can read once an organization is verified.
revoke select (bsis_license_type, bsis_license_number) on public.organizations from anon, authenticated;

revoke update on table public.jobs from anon, authenticated;
grant update (
  title, description, job_type, category, is_armed, urgency,
  city, county, postal_code,
  starts_at, ends_at, recurrence_rule,
  pay_type, pay_min_cents, pay_max_cents,
  workers_needed, min_years_experience,
  uniform_notes, vehicle_required, equipment_notes, application_deadline
) on public.jobs to authenticated;

revoke select (site_address_private) on public.jobs from anon, authenticated;
revoke insert (site_lat, site_lng, site_address_private) on public.jobs from anon, authenticated;
revoke update (site_lat, site_lng, site_address_private) on public.jobs from anon, authenticated;

revoke all on public.worker_search_cards from anon, authenticated;
grant select on public.worker_search_cards to authenticated;

revoke all on public.job_private_locations from anon, authenticated;
grant select, insert, update, delete on public.job_private_locations to authenticated;

revoke all on public.organization_invites from anon, authenticated;
grant select on public.organization_invites to authenticated;
revoke select (token_hash) on public.organization_invites from anon, authenticated;

-- ---------------------------------------------------------------------
-- RLS. New tables are forced. Overlapping SELECT policies are replaced
-- by a single equivalent policy, except employer access to the full
-- worker profile, which is dropped.
-- ---------------------------------------------------------------------
alter table public.worker_search_cards enable row level security;
alter table public.worker_search_cards force row level security;
alter table public.job_private_locations enable row level security;
alter table public.job_private_locations force row level security;
alter table public.organization_invites enable row level security;
alter table public.organization_invites force row level security;

drop policy if exists wp_employer_read on public.worker_profiles;
drop policy if exists wp_owner_read on public.worker_profiles;
drop policy if exists wp_staff_read on public.worker_profiles;
create policy wp_read on public.worker_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_staff());

create policy wsc_read on public.worker_search_cards
  for select to authenticated
  using (
    app.is_staff()
    or exists (
      select 1 from public.organization_members m
      where m.user_id = (select auth.uid())
    )
  );

drop policy if exists om_admin_manage on public.organization_members;

create policy oi_read on public.organization_invites
  for select to authenticated
  using (
    app.is_org_member(organization_id, array['owner_admin']::public.org_member_role[])
    or app.is_staff()
  );

drop policy if exists wa_owner_all on public.worker_availability;
drop policy if exists wa_staff_read on public.worker_availability;
create policy wa_read on public.worker_availability
  for select to authenticated
  using (worker_id = (select auth.uid()) or app.is_staff());
create policy wa_insert on public.worker_availability
  for insert to authenticated
  with check (worker_id = (select auth.uid()));
create policy wa_update on public.worker_availability
  for update to authenticated
  using (worker_id = (select auth.uid()))
  with check (worker_id = (select auth.uid()));
create policy wa_delete on public.worker_availability
  for delete to authenticated
  using (worker_id = (select auth.uid()));

drop policy if exists jobs_public_read on public.jobs;
drop policy if exists jobs_org_read on public.jobs;
create policy jobs_anon_read on public.jobs
  for select to anon
  using (status = 'published');
create policy jobs_auth_read on public.jobs
  for select to authenticated
  using (
    status = 'published'
    or app.is_org_member(organization_id)
    or app.is_staff()
  );

drop policy if exists jobs_org_write on public.jobs;
create policy jobs_org_write on public.jobs
  for insert to authenticated
  with check (
    app.is_org_member(organization_id)
    and status = 'draft'
    and created_by = (select auth.uid())
  );

drop policy if exists jobs_org_update on public.jobs;
create policy jobs_org_update on public.jobs
  for update to authenticated
  using (
    app.is_org_member(organization_id)
    and status in ('draft', 'pending_review')
  )
  with check (
    app.is_org_member(organization_id)
    and status in ('draft', 'pending_review')
  );

drop policy if exists jr_org_write on public.job_requirements;
create policy jr_insert on public.job_requirements
  for insert to authenticated
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.status in ('draft', 'pending_review')
        and app.is_org_member(j.organization_id)
    )
  );
create policy jr_update on public.job_requirements
  for update to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.status in ('draft', 'pending_review')
        and app.is_org_member(j.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.status in ('draft', 'pending_review')
        and app.is_org_member(j.organization_id)
    )
  );
create policy jr_delete on public.job_requirements
  for delete to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.status in ('draft', 'pending_review')
        and app.is_org_member(j.organization_id)
    )
  );

drop policy if exists app_worker_read on public.applications;
drop policy if exists app_org_read on public.applications;
create policy app_read on public.applications
  for select to authenticated
  using (
    worker_id = (select auth.uid())
    or app.is_staff()
    or exists (
      select 1 from public.jobs j
      where j.id = job_id
        and app.is_org_member(j.organization_id)
    )
  );

create policy jpl_read on public.job_private_locations
  for select to authenticated
  using (
    app.is_staff()
    or exists (
      select 1 from public.jobs j
      where j.id = job_id
        and app.is_org_member(j.organization_id)
    )
    or exists (
      select 1 from public.applications a
      where a.job_id = job_private_locations.job_id
        and a.worker_id = (select auth.uid())
    )
    or exists (
      select 1 from public.assignments s
      where s.job_id = job_private_locations.job_id
        and s.worker_id = (select auth.uid())
    )
  );

create policy jpl_insert on public.job_private_locations
  for insert to authenticated
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.status in ('draft', 'pending_review', 'published', 'filled', 'in_progress')
        and app.is_org_member(j.organization_id)
    )
  );
create policy jpl_update on public.job_private_locations
  for update to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.status in ('draft', 'pending_review', 'published', 'filled', 'in_progress')
        and app.is_org_member(j.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.status in ('draft', 'pending_review', 'published', 'filled', 'in_progress')
        and app.is_org_member(j.organization_id)
    )
  );
create policy jpl_delete on public.job_private_locations
  for delete to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.status in ('draft', 'pending_review', 'published', 'filled', 'in_progress')
        and app.is_org_member(j.organization_id)
    )
  );

-- ---------------------------------------------------------------------
-- Organization RPCs. Actor is auth.uid(). Verification is never set to
-- verified here.
-- ---------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_org_type public.org_type,
  p_website text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_description text default null,
  p_service_counties text[] default '{}',
  p_bsis_license_type text default null,
  p_bsis_license_number text default null,
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
  v_account public.account_type;
  v_status public.account_status;
  v_id uuid;
  v_counties text[] := app.clean_counties(p_service_counties);
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
  v_email text := nullif(btrim(coalesce(p_contact_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_license_type text := nullif(btrim(coalesce(p_bsis_license_type, '')), '');
  v_license_number text := nullif(btrim(coalesce(p_bsis_license_number, '')), '');
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select account_type, status into v_account, v_status from public.profiles where id = v_uid;
  if v_account is distinct from 'employer' or v_status in ('suspended', 'deactivated') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if (select count(*) from public.organizations where created_by = v_uid) >= 10 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 200
     or not app.counties_ok(v_counties)
     or (v_description is not null and char_length(v_description) > 5000) then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  insert into public.organizations (
    name, org_type, website, contact_email, contact_phone_e164, description,
    service_counties, bsis_license_type, bsis_license_number, created_by
  ) values (
    v_name, p_org_type, v_website, v_email::public.citext, v_phone, v_description,
    v_counties, v_license_type, v_license_number, v_uid
  ) returning id into v_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_id, v_uid, 'owner_admin');

  update public.employer_profiles
     set primary_organization_id = v_id
   where user_id = v_uid
     and primary_organization_id is null;

  perform app.write_audit(
    'user', v_uid, v_id, 'organization.created', 'organization', v_id,
    null,
    jsonb_build_object('org_type', p_org_type, 'has_license_number', v_license_number is not null),
    p_ip, p_user_agent, p_request_id
  );
  return v_id;
end
$$;

create or replace function public.update_organization(
  p_org uuid,
  p_name text,
  p_org_type public.org_type,
  p_website text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_description text default null,
  p_service_counties text[] default '{}',
  p_bsis_license_type text default null,
  p_bsis_license_number text default null,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org public.organizations%rowtype;
  v_counties text[] := app.clean_counties(p_service_counties);
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
  v_email text := nullif(btrim(coalesce(p_contact_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_license_type text := nullif(btrim(coalesce(p_bsis_license_type, '')), '');
  v_license_number text := nullif(btrim(coalesce(p_bsis_license_number, '')), '');
  v_name text := btrim(coalesce(p_name, ''));
  v_reset boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not app.is_org_member(p_org, array['owner_admin']::public.org_member_role[]) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into v_org from public.organizations where id = p_org for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 200
     or not app.counties_ok(v_counties)
     or (v_description is not null and char_length(v_description) > 5000) then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  v_reset := v_org.verification_status in ('pending', 'verified')
    and (
      v_org.org_type is distinct from p_org_type
      or v_org.bsis_license_type is distinct from v_license_type
      or v_org.bsis_license_number is distinct from v_license_number
    );
  if v_reset then
    perform set_config('app.org_verification_transition', '1', true);
  end if;

  update public.organizations set
    name = v_name,
    org_type = p_org_type,
    website = v_website,
    contact_email = v_email::public.citext,
    contact_phone_e164 = v_phone,
    description = v_description,
    service_counties = v_counties,
    bsis_license_type = v_license_type,
    bsis_license_number = v_license_number,
    verification_status = case when v_reset then 'unverified'::public.verification_status else verification_status end,
    verified_at = case when v_reset then null else verified_at end
  where id = p_org;

  perform app.write_audit(
    'user', v_uid, p_org, 'organization.updated', 'organization', p_org,
    jsonb_build_object('verification_status', v_org.verification_status),
    jsonb_build_object('verification_reset', v_reset, 'has_license_number', v_license_number is not null),
    p_ip, p_user_agent, p_request_id
  );
end
$$;

create or replace function public.set_organization_logo(
  p_org uuid,
  p_path text,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if v_uid is null or not app.is_org_member(p_org, array['owner_admin']::public.org_member_role[]) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not app.org_logo_path_ok(p_org, v_path) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  update public.organizations set logo_path = v_path where id = p_org;
  perform app.write_audit(
    'user', v_uid, p_org, 'organization.logo_updated', 'organization', p_org,
    null, jsonb_build_object('cleared', v_path is null),
    p_ip, p_user_agent, p_request_id
  );
end
$$;

create or replace function public.submit_organization_verification(
  p_org uuid,
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
  v_org public.organizations%rowtype;
begin
  if v_uid is null or not app.is_org_member(p_org, array['owner_admin']::public.org_member_role[]) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into v_org from public.organizations where id = p_org for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if v_org.verification_status not in ('unverified', 'rejected', 'expired') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_org.contact_email is null then
    raise exception 'contact email required' using errcode = '22023';
  end if;
  if v_org.org_type in ('ppo', 'private_patrol_operator_branch', 'proprietary_security_employer')
     and nullif(btrim(coalesce(v_org.bsis_license_number, '')), '') is null then
    raise exception 'license number required' using errcode = '22023';
  end if;

  perform set_config('app.org_verification_transition', '1', true);
  update public.organizations
     set verification_status = 'pending',
         verified_at = null
   where id = p_org;

  perform app.write_audit(
    'user', v_uid, p_org, 'organization.verification_submitted', 'organization', p_org,
    jsonb_build_object('verification_status', v_org.verification_status),
    jsonb_build_object('verification_status', 'pending'),
    p_ip, p_user_agent, p_request_id
  );
  return 'pending';
end
$$;

create or replace function public.review_organization(
  p_org uuid,
  p_result public.verification_status,
  p_notes text,
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
  v_role public.platform_role;
  v_account public.account_status;
  v_org public.organizations%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select platform_role, status into v_role, v_account from public.profiles where id = v_uid;
  if v_role is null or v_role not in ('moderator', 'admin', 'super_admin')
     or v_account in ('suspended', 'deactivated') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_result not in ('verified', 'rejected') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if v_notes is null or char_length(v_notes) < 8 or char_length(v_notes) > 4000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  select * into v_org from public.organizations where id = p_org for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if v_org.created_by = v_uid or app.is_org_member(p_org) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_org.verification_status is distinct from 'pending' then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  perform set_config('app.org_verification_transition', '1', true);
  update public.organizations set
    verification_status = p_result,
    verified_at = case when p_result = 'verified' then pg_catalog.now() else null end
  where id = p_org;

  insert into public.admin_actions (admin_id, action, target_type, target_id, reason, confirmed_at, metadata)
  values (
    v_uid,
    case when p_result = 'verified' then 'verify_organization' else 'reject_organization' end,
    'organization',
    p_org,
    v_notes,
    pg_catalog.now(),
    jsonb_build_object('result', p_result)
  );

  perform app.write_audit(
    'admin', v_uid, p_org, 'organization.verification_reviewed', 'organization', p_org,
    jsonb_build_object('verification_status', v_org.verification_status),
    jsonb_build_object('verification_status', p_result),
    p_ip, p_user_agent, p_request_id
  );

  insert into public.notifications (user_id, event_type, title, body, link_path, data)
  select m.user_id,
         case when p_result = 'verified' then 'organization_verified' else 'organization_rejected' end,
         case when p_result = 'verified' then 'Organization verified' else 'Organization verification needs attention' end,
         case when p_result = 'verified'
           then 'A moderator recorded your organization as verified. The license number was not checked automatically.'
           else 'A moderator did not verify your organization. You can update the profile and submit it again.'
         end,
         '/employer/org',
         jsonb_build_object('organization_id', p_org, 'status', p_result)
  from public.organization_members m
  where m.organization_id = p_org
    and m.role = 'owner_admin';

  return p_result;
end
$$;

comment on function public.review_organization(uuid, public.verification_status, text, text, text, text) is
  'Staff-only human decision. Does not call BSIS or any registry. License numbers are not copied into the audit payload.';

create or replace function public.organization_license(p_org uuid)
returns table (license_type text, license_number text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (app.is_org_member(p_org) or app.is_staff()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return query
    select o.bsis_license_type, o.bsis_license_number
    from public.organizations o
    where o.id = p_org;
end
$$;

comment on function public.organization_license(uuid) is
  'License type and number as stored. Members and staff only. Not a verification.';

create or replace function public.organization_roster(p_org uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role public.org_member_role
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (app.is_org_member(p_org) or app.is_staff()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.display_name, p.email::text, m.role
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = p_org
    order by p.display_name;
end
$$;

comment on function public.organization_roster(uuid) is
  'Co-member names and emails for one organization. Does not return phone numbers.';

create or replace function public.create_organization_invite(
  p_org uuid,
  p_email text,
  p_role public.org_member_role,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_token text;
  v_id uuid;
begin
  if v_uid is null or not app.is_org_member(p_org, array['owner_admin']::public.org_member_role[]) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_email is null or char_length(v_email) > 200
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.profiles p
    join public.organization_members m on m.user_id = p.id
    where m.organization_id = p_org
      and p.email = v_email::public.citext
  ) then
    raise exception 'already a member' using errcode = '23505';
  end if;

  update public.organization_invites
     set revoked_at = pg_catalog.now()
   where organization_id = p_org
     and email = v_email::public.citext
     and accepted_at is null
     and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.organization_invites (organization_id, email, role, token_hash, invited_by, expires_at)
  values (
    p_org,
    v_email::public.citext,
    p_role,
    app.sha256_hex(v_token),
    v_uid,
    pg_catalog.now() + interval '14 days'
  ) returning id into v_id;

  insert into public.notifications (user_id, event_type, title, body, link_path, data)
  select p.id, 'org_invite', 'Organization invite',
         'An organization invited you. Ask the person who invited you for the accept link. GuardGig does not email invites.',
         '/employer/invites/accept',
         jsonb_build_object('organization_id', p_org, 'invite_id', v_id)
  from public.profiles p
  where p.email = v_email::public.citext;

  perform app.write_audit(
    'user', v_uid, p_org, 'organization.invite_created', 'organization_invite', v_id,
    null, jsonb_build_object('role', p_role),
    p_ip, p_user_agent, p_request_id
  );
  return v_token;
end
$$;

create or replace function public.revoke_organization_invite(
  p_invite uuid,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  select organization_id into v_org
  from public.organization_invites
  where id = p_invite
    and accepted_at is null
    and revoked_at is null
  for update;
  if not found then
    raise exception 'invite invalid' using errcode = '42501';
  end if;
  if v_uid is null or not app.is_org_member(v_org, array['owner_admin']::public.org_member_role[]) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.organization_invites set revoked_at = pg_catalog.now() where id = p_invite;
  perform app.write_audit(
    'user', v_uid, v_org, 'organization.invite_revoked', 'organization_invite', p_invite,
    null, null, p_ip, p_user_agent, p_request_id
  );
end
$$;

create or replace function public.accept_organization_invite(
  p_token text,
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
  v_account public.account_type;
  v_status public.account_status;
  v_email public.citext;
  v_inv public.organization_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 200 then
    raise exception 'invite invalid' using errcode = '42501';
  end if;
  select account_type, status, email into v_account, v_status, v_email
  from public.profiles where id = v_uid;
  if v_status in ('suspended', 'deactivated') then
    raise exception 'account not active' using errcode = '42501';
  end if;
  if v_account is distinct from 'employer' then
    raise exception 'employer account required' using errcode = '42501';
  end if;

  select * into v_inv
  from public.organization_invites
  where token_hash = app.sha256_hex(p_token)
  for update;
  if not found
     or v_inv.revoked_at is not null
     or v_inv.accepted_at is not null
     or v_inv.expires_at <= pg_catalog.now() then
    raise exception 'invite invalid' using errcode = '42501';
  end if;
  if v_email is distinct from v_inv.email then
    raise exception 'invite email mismatch' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = v_inv.organization_id and m.user_id = v_uid
  ) then
    raise exception 'already a member' using errcode = '23505';
  end if;

  insert into public.organization_members (organization_id, user_id, role, invited_by)
  values (v_inv.organization_id, v_uid, v_inv.role, v_inv.invited_by);
  update public.organization_invites
     set accepted_at = pg_catalog.now(),
         accepted_by = v_uid
   where id = v_inv.id;
  update public.employer_profiles
     set primary_organization_id = v_inv.organization_id
   where user_id = v_uid
     and primary_organization_id is null;

  perform app.write_audit(
    'user', v_uid, v_inv.organization_id, 'organization.invite_accepted', 'organization_invite', v_inv.id,
    null, jsonb_build_object('role', v_inv.role),
    p_ip, p_user_agent, p_request_id
  );
  return v_inv.organization_id;
end
$$;

create or replace function public.change_org_member_role(
  p_org uuid,
  p_user uuid,
  p_role public.org_member_role,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.org_member_role;
begin
  if v_uid is null or not app.is_org_member(p_org, array['owner_admin']::public.org_member_role[]) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select role into v_old
  from public.organization_members
  where organization_id = p_org and user_id = p_user
  for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_old = p_role then
    return;
  end if;
  update public.organization_members
     set role = p_role
   where organization_id = p_org and user_id = p_user;
  perform app.write_audit(
    'user', v_uid, p_org, 'organization.member_role_changed', 'organization_member', p_user,
    jsonb_build_object('role', v_old),
    jsonb_build_object('role', p_role),
    p_ip, p_user_agent, p_request_id
  );
end
$$;

create or replace function public.remove_org_member(
  p_org uuid,
  p_user uuid,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.org_member_role;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_uid is distinct from p_user
     and not app.is_org_member(p_org, array['owner_admin']::public.org_member_role[]) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select role into v_role
  from public.organization_members
  where organization_id = p_org and user_id = p_user
  for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  delete from public.organization_members
  where organization_id = p_org and user_id = p_user;
  update public.employer_profiles
     set primary_organization_id = null
   where user_id = p_user
     and primary_organization_id = p_org;
  perform app.write_audit(
    'user', v_uid, p_org, 'organization.member_removed', 'organization_member', p_user,
    jsonb_build_object('role', v_role),
    null, p_ip, p_user_agent, p_request_id
  );
end
$$;

-- ---------------------------------------------------------------------
-- Jobs. Publish from an unverified organization becomes pending_review.
-- published is rejected by the trigger unless the organization is verified.
-- ---------------------------------------------------------------------
create or replace function public.transition_job(
  p_job_id uuid,
  p_target public.job_status,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs%rowtype;
  v_verified boolean;
  v_target public.job_status;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  if not app.is_org_member(v_job.organization_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select o.verification_status = 'verified' into v_verified
  from public.organizations o
  where o.id = v_job.organization_id;

  v_target := p_target;
  if p_target = 'published' and not coalesce(v_verified, false) then
    if v_job.status = 'draft' then
      v_target := 'pending_review';
    elsif v_job.status = 'pending_review' then
      return 'pending_review';
    else
      raise exception 'illegal job transition' using errcode = '42501';
    end if;
  end if;
  if v_target = v_job.status then
    return v_job.status;
  end if;

  perform set_config('app.job_status_transition', '1', true);
  update public.jobs
     set status = v_target
   where id = p_job_id;

  perform app.write_audit(
    'user', v_uid, v_job.organization_id, 'job.transition', 'job', p_job_id,
    jsonb_build_object('status', v_job.status),
    jsonb_build_object('status', v_target, 'requested', p_target),
    p_ip, p_user_agent, p_request_id
  );
  return v_target;
end
$$;

create or replace function public.set_job_requirements(
  p_job_id uuid,
  p_credential_type_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_status public.job_status;
  v_ids uuid[];
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select organization_id, status into v_org, v_status
  from public.jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  if not app.is_org_member(v_org) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'pending_review') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_credential_type_ids, '{}'::uuid[])) as x
  where x is not null;
  if cardinality(v_ids) > 20 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(v_ids) as requested(id)
    left join public.credential_types ct on ct.id = requested.id and ct.is_active
    where ct.id is null
  ) then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  delete from public.job_requirements where job_id = p_job_id;
  insert into public.job_requirements (job_id, credential_type_id, is_mandatory)
  select p_job_id, id, true
  from unnest(v_ids) as id;
end
$$;

revoke all on function app.sha256_hex(text) from public, anon, authenticated;
revoke all on function app.write_audit(public.actor_type, uuid, uuid, text, text, uuid, jsonb, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function app.clean_counties(text[]) from public;
revoke all on function app.counties_ok(text[]) from public;
revoke all on function app.org_logo_path_ok(uuid, text) from public;
revoke all on function app.org_verification_ok(public.verification_status, public.verification_status) from public;
revoke all on function app.job_transition_ok(public.job_status, public.job_status, boolean) from public;
revoke all on function app.job_post_complete(public.jobs) from public;
revoke all on function app.guard_organization_write() from public;
revoke all on function app.guard_job_write() from public;
revoke all on function app.allow_org_member_cascade() from public;
revoke all on function app.guard_org_member() from public;
revoke all on function app.sync_worker_search_card() from public;
revoke all on function app.sync_worker_card_name() from public;

grant execute on function app.clean_counties(text[]) to authenticated, service_role;
grant execute on function app.counties_ok(text[]) to authenticated, service_role;
grant execute on function app.org_logo_path_ok(uuid, text) to authenticated, service_role;
grant execute on function app.org_verification_ok(public.verification_status, public.verification_status) to authenticated, service_role;
grant execute on function app.job_transition_ok(public.job_status, public.job_status, boolean) to authenticated, service_role;
grant execute on function app.job_post_complete(public.jobs) to authenticated, service_role;
grant execute on function app.guard_organization_write() to authenticated, service_role;
grant execute on function app.guard_job_write() to authenticated, service_role;
grant execute on function app.allow_org_member_cascade() to authenticated, service_role;
grant execute on function app.guard_org_member() to authenticated, service_role;
grant execute on function app.sync_worker_search_card() to authenticated, service_role;
grant execute on function app.sync_worker_card_name() to authenticated, service_role;

revoke all on function public.organization_license(uuid) from public, anon;
grant execute on function public.organization_license(uuid) to authenticated;
revoke all on function public.organization_roster(uuid) from public, anon;
grant execute on function public.organization_roster(uuid) to authenticated;

revoke all on function public.create_organization(text, public.org_type, text, text, text, text, text[], text, text, text, text, text) from public, anon;
revoke all on function public.update_organization(uuid, text, public.org_type, text, text, text, text, text[], text, text, text, text, text) from public, anon;
revoke all on function public.set_organization_logo(uuid, text, text, text, text) from public, anon;
revoke all on function public.submit_organization_verification(uuid, text, text, text) from public, anon;
revoke all on function public.review_organization(uuid, public.verification_status, text, text, text, text) from public, anon;
revoke all on function public.create_organization_invite(uuid, text, public.org_member_role, text, text, text) from public, anon;
revoke all on function public.revoke_organization_invite(uuid, text, text, text) from public, anon;
revoke all on function public.accept_organization_invite(text, text, text, text) from public, anon;
revoke all on function public.change_org_member_role(uuid, uuid, public.org_member_role, text, text, text) from public, anon;
revoke all on function public.remove_org_member(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.transition_job(uuid, public.job_status, text, text, text) from public, anon;
revoke all on function public.set_job_requirements(uuid, uuid[]) from public, anon;

grant execute on function public.create_organization(text, public.org_type, text, text, text, text, text[], text, text, text, text, text) to authenticated;
grant execute on function public.update_organization(uuid, text, public.org_type, text, text, text, text, text[], text, text, text, text, text) to authenticated;
grant execute on function public.set_organization_logo(uuid, text, text, text, text) to authenticated;
grant execute on function public.submit_organization_verification(uuid, text, text, text) to authenticated;
grant execute on function public.review_organization(uuid, public.verification_status, text, text, text, text) to authenticated;
grant execute on function public.create_organization_invite(uuid, text, public.org_member_role, text, text, text) to authenticated;
grant execute on function public.revoke_organization_invite(uuid, text, text, text) to authenticated;
grant execute on function public.accept_organization_invite(text, text, text, text) to authenticated;
grant execute on function public.change_org_member_role(uuid, uuid, public.org_member_role, text, text, text) to authenticated;
grant execute on function public.remove_org_member(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.transition_job(uuid, public.job_status, text, text, text) to authenticated;
grant execute on function public.set_job_requirements(uuid, uuid[]) to authenticated;
