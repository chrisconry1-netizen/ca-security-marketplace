-- =====================================================================
-- 0005_job_marketplace.sql — Phase 4 job & shift marketplace
-- Additive only: new columns, reference rows, functions, indexes, and
-- tighter privileges. No tables, columns, or rows are dropped.
--
-- Public radius search uses approximate coordinates only:
--   * jobs.approx_lat / approx_lng, rounded to 0.01 degrees (~1 km)
--   * filled from public.place_centroids (California city / ZIP centroids)
--     or from an employer-entered approximate point, never from site_lat
--     / site_lng
-- Private site_address_private, site_lat, and site_lng are not selectable
-- by anon or authenticated. Authorized callers use public.job_private_site.
--
-- Geocoding providers are not called. PostGIS is not required; distance is
-- a bounding box plus haversine on the approximate point.
--
-- Application status changes and assignment inserts are rejected unless a
-- security-definer function sets a transaction-local GUC. Workers submit,
-- withdraw, accept, or decline. Org members move reviewing / shortlisted /
-- interview / offered / rejected. Nothing is accepted or rejected
-- automatically. Accepting an offer is the only insert path for assignments.
-- =====================================================================

alter table public.jobs
  add column if not exists approx_lat numeric(8,5),
  add column if not exists approx_lng numeric(8,5),
  add column if not exists shift_period text;

alter table public.jobs
  add constraint jobs_approx_lat_range check (approx_lat is null or approx_lat between -90 and 90),
  add constraint jobs_approx_lng_range check (approx_lng is null or approx_lng between -180 and 180),
  add constraint jobs_site_lat_range check (site_lat is null or site_lat between -90 and 90),
  add constraint jobs_site_lng_range check (site_lng is null or site_lng between -180 and 180),
  add constraint jobs_shift_period_value check (shift_period is null or shift_period in ('day', 'swing', 'night')),
  add constraint jobs_site_address_len check (site_address_private is null or char_length(site_address_private) between 1 and 300),
  add constraint jobs_published_public_point check (
    status <> 'published'
    or (
      approx_lat is not null
      and approx_lng is not null
      and pay_min_cents is not null
      and (nullif(btrim(coalesce(city, '')), '') is not null or nullif(btrim(coalesce(postal_code, '')), '') is not null)
    )
  );

comment on column public.jobs.approx_lat is
  'Public approximate latitude, rounded to 0.01 degrees. Not the private site pin.';
comment on column public.jobs.approx_lng is
  'Public approximate longitude, rounded to 0.01 degrees. Not the private site pin.';
comment on column public.jobs.shift_period is
  'Pacific start-hour bucket: day 06–14, swing 14–22, night otherwise. Maintained by trigger.';
comment on column public.jobs.site_lat is
  'Private site latitude. Not granted to anon or authenticated.';
comment on column public.jobs.site_lng is
  'Private site longitude. Not granted to anon or authenticated.';
comment on column public.jobs.site_address_private is
  'Private site address. Revealed only by public.job_private_site to org members, staff, or assigned workers.';

-- ---------------------------------------------------------------------
-- California place centroids. Public reference data for radius search.
-- Approximate city and ZIP centers, not a geocoder and not survey marks.
-- ---------------------------------------------------------------------
create table public.place_centroids (
  id uuid primary key default gen_random_uuid(),
  state_code text not null default 'CA',
  county text,
  city text,
  postal_code text,
  label text not null,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  source text not null default 'approximate_public_centroid',
  created_at timestamptz not null default now(),
  constraint place_centroids_state check (state_code = 'CA'),
  constraint place_centroids_lat check (lat between -90 and 90),
  constraint place_centroids_lng check (lng between -180 and 180),
  constraint place_centroids_place check (city is not null or postal_code is not null),
  constraint place_centroids_postal check (postal_code is null or postal_code ~ '^\d{5}$')
);

create unique index place_centroids_postal_uidx
  on public.place_centroids (postal_code)
  where postal_code is not null;
create unique index place_centroids_city_uidx
  on public.place_centroids (lower(city), lower(coalesce(county, '')))
  where city is not null and postal_code is null;

alter table public.place_centroids enable row level security;
alter table public.place_centroids force row level security;

create policy place_centroids_read on public.place_centroids
  for select to anon, authenticated
  using (true);

create policy ct_anon_read on public.credential_types
  for select to anon
  using (is_active);

revoke all on table public.place_centroids from public, anon, authenticated;
grant select on table public.place_centroids to anon, authenticated;

comment on table public.place_centroids is
  'Approximate California city and ZIP centroids for marketplace radius search. Not a live geocoder.';

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function app.looks_like_street(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null and (
    btrim(p_value) ~ '^\d+'
    or btrim(p_value) ~* '\m(street|avenue|boulevard|highway|drive|lane|court|place|terrace|circle|road)\M'
  )
$$;

create or replace function app.shift_period_of(p_starts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_starts is null then null::text
    when extract(hour from p_starts at time zone 'America/Los_Angeles') >= 6
     and extract(hour from p_starts at time zone 'America/Los_Angeles') < 14 then 'day'
    when extract(hour from p_starts at time zone 'America/Los_Angeles') >= 14
     and extract(hour from p_starts at time zone 'America/Los_Angeles') < 22 then 'swing'
    else 'night'
  end
$$;

create or replace function app.pacific_timestamp(p_local text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_local, '')), '');
begin
  if v is null then
    return null;
  end if;
  if v !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
    raise exception 'invalid local time' using errcode = '22023';
  end if;
  return (replace(v, 'T', ' ')::timestamp) at time zone 'America/Los_Angeles';
end
$$;

create or replace function app.lookup_centroid(p_city text, p_county text, p_postal text)
returns table (lat numeric, lng numeric)
language sql
stable
set search_path = ''
as $$
  select c.lat, c.lng
  from public.place_centroids c
  where c.state_code = 'CA'
    and (
      (
        nullif(btrim(coalesce(p_postal, '')), '') is not null
        and c.postal_code = left(btrim(p_postal), 5)
      )
      or (
        nullif(btrim(coalesce(p_city, '')), '') is not null
        and c.postal_code is null
        and lower(c.city) = lower(btrim(p_city))
        and (
          nullif(btrim(coalesce(p_county, '')), '') is null
          or c.county is null
          or lower(c.county) = lower(btrim(p_county))
        )
      )
    )
  order by
    case
      when nullif(btrim(coalesce(p_postal, '')), '') is not null
       and c.postal_code = left(btrim(p_postal), 5) then 0
      else 1
    end,
    case
      when nullif(btrim(coalesce(p_county, '')), '') is not null
       and lower(coalesce(c.county, '')) = lower(btrim(p_county)) then 0
      else 1
    end,
    c.city,
    c.id
  limit 1
$$;

create or replace function app.miles_between(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select round((3958.7613 * acos(least(1::numeric, greatest(-1::numeric,
    cos(radians(p_lat1)) * cos(radians(p_lat2)) * cos(radians(p_lng2) - radians(p_lng1))
    + sin(radians(p_lat1)) * sin(radians(p_lat2))
  ))))::numeric, 3)
$$;

create or replace function app.ilike_contains(p_haystack text, p_needle text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_haystack, '') ilike (
    '%' || replace(replace(replace(coalesce(p_needle, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ) escape '\'
$$;

-- Null when the worker's verified credentials cover the shift. Otherwise a
-- stable error string. Invoker + RLS: a caller cannot read another worker's
-- credential rows, so this is not an oracle. submit_application is definer
-- and therefore sees the applicant's own rows when it passes auth.uid().
create or replace function app.eligibility_block(
  p_worker uuid,
  p_armed boolean,
  p_starts timestamptz,
  p_job uuid
) returns text
language sql
stable
set search_path = ''
as $$
  with shift_day as (
    select coalesce((p_starts at time zone 'America/Los_Angeles')::date, app.pacific_today()) as day
  ),
  held as (
    select t.code
    from public.credentials c
    join public.credential_types t on t.id = c.credential_type_id
    cross join shift_day d
    where c.worker_id = p_worker
      and c.status = 'verified'
      and (c.expires_on is null or c.expires_on >= d.day)
  )
  select case
    when p_worker is null then 'not authenticated'
    when coalesce(p_armed, false)
      and (
        not exists (select 1 from held where code = 'ca_guard_registration')
        or not exists (select 1 from held where code = 'ca_exposed_firearm_permit')
      ) then 'armed credential missing'
    when exists (
      select 1
      from public.job_requirements jr
      join public.credential_types t on t.id = jr.credential_type_id
      where jr.job_id = p_job
        and jr.is_mandatory
        and not exists (select 1 from held h where h.code = t.code)
    ) then 'mandatory credential missing'
    else null
  end
$$;

create or replace function app.job_block_reason(
  p_status public.job_status,
  p_deadline timestamptz,
  p_ends timestamptz,
  p_needed smallint,
  p_filled integer
) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status is distinct from 'published' then 'job is not open'
    when p_deadline is not null and p_deadline <= pg_catalog.now() then 'job has expired'
    when p_ends is not null and p_ends <= pg_catalog.now() then 'job has expired'
    when coalesce(p_filled, 0) >= coalesce(p_needed, 1) then 'job is filled'
    else null
  end
$$;

create or replace function app.active_assignment_count(p_job uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.assignments a
  where a.job_id = p_job
    and a.status in ('pending_confirmation', 'confirmed', 'in_progress', 'completed', 'disputed')
$$;

create or replace function app.notify_user(
  p_user uuid,
  p_event text,
  p_title text,
  p_body text,
  p_link text,
  p_data jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, event_type, title, body, link_path, data)
  values (p_user, p_event, left(p_title, 140), left(p_body, 500), left(p_link, 200), coalesce(p_data, '{}'::jsonb))
$$;

create or replace function app.audit_marketplace(
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity uuid,
  p_org uuid,
  p_before jsonb,
  p_after jsonb,
  p_user_agent text,
  p_request_id text,
  p_ip text
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    actor_type, actor_id, organization_id, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent, request_id
  ) values (
    'user', p_actor, p_org, p_action, p_entity_type, p_entity, p_before, p_after,
    app.try_inet(p_ip), left(p_user_agent, 512), left(p_request_id, 128)
  )
$$;

-- ---------------------------------------------------------------------
-- Job write guard. Public coordinates never copy the private site pin.
-- ---------------------------------------------------------------------
create or replace function app.guard_job_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lat numeric;
  v_lng numeric;
  v_transition text := current_setting('app.job_status_transition', true);
begin
  new.city := nullif(btrim(coalesce(new.city, '')), '');
  new.county := nullif(btrim(coalesce(new.county, '')), '');
  new.postal_code := nullif(btrim(coalesce(new.postal_code, '')), '');
  new.site_address_private := nullif(btrim(coalesce(new.site_address_private, '')), '');

  if app.looks_like_street(new.city) or app.looks_like_street(new.county) then
    raise exception 'public location cannot be a street address' using errcode = '22023';
  end if;
  if new.postal_code is not null and new.postal_code !~ '^\d{5}(-\d{4})?$' then
    raise exception 'invalid postal code' using errcode = '22023';
  end if;
  if char_length(coalesce(new.city, '')) > 80 or char_length(coalesce(new.county, '')) > 80 then
    raise exception 'location is too long' using errcode = '22023';
  end if;

  new.shift_period := app.shift_period_of(new.starts_at);

  if new.approx_lat is null or new.approx_lng is null then
    select c.lat, c.lng into v_lat, v_lng
    from app.lookup_centroid(new.city, new.county, new.postal_code) c;
    if v_lat is not null and v_lng is not null then
      new.approx_lat := pg_catalog.round(v_lat, 2);
      new.approx_lng := pg_catalog.round(v_lng, 2);
    end if;
  else
    new.approx_lat := pg_catalog.round(new.approx_lat, 2);
    new.approx_lng := pg_catalog.round(new.approx_lng, 2);
  end if;

  if tg_op = 'INSERT' then
    if v_transition is distinct from 'publish' and new.status not in ('draft', 'pending_review') then
      raise exception 'new jobs start as draft or pending review' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by then
    raise exception 'job identity is immutable' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if v_transition = 'publish'
     and old.status in ('draft', 'pending_review')
     and new.status in ('published', 'pending_review') then
    if new.status = 'published' then
      new.published_at := coalesce(old.published_at, pg_catalog.now());
    end if;
    return new;
  end if;

  raise exception 'job status is not client-writable' using errcode = '42501';
end
$$;

drop trigger if exists jobs_guard_write on public.jobs;
create trigger jobs_guard_write
  before insert or update on public.jobs
  for each row execute function app.guard_job_write();

-- ---------------------------------------------------------------------
-- Application state machine. Keep in sync with src/lib/jobs/state.ts.
-- ---------------------------------------------------------------------
create or replace function app.guard_application_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_op text := current_setting('app.application_transition', true);
begin
  if tg_op = 'INSERT' then
    if v_op is distinct from 'submit' or new.status is distinct from 'submitted' or new.submitted_via is distinct from 'user' then
      raise exception 'applications are created only by submit_application' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.job_id is distinct from old.job_id
     or new.worker_id is distinct from old.worker_id
     or new.cover_note is distinct from old.cover_note
     or new.submitted_via is distinct from old.submitted_via
     or new.created_at is distinct from old.created_at then
    raise exception 'application fields are immutable' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if v_op = 'withdraw'
     and new.status = 'withdrawn'
     and old.status in ('submitted', 'reviewing', 'shortlisted', 'interview', 'offered') then
    new.status_changed_at := pg_catalog.now();
    return new;
  end if;

  if v_op = 'accept' and old.status = 'offered' and new.status = 'accepted' then
    new.status_changed_at := pg_catalog.now();
    return new;
  end if;

  if v_op = 'decline' and old.status = 'offered' and new.status = 'declined' then
    new.status_changed_at := pg_catalog.now();
    return new;
  end if;

  if v_op = 'employer'
     and (
       (old.status in ('submitted', 'reviewing', 'shortlisted', 'interview')
         and new.status in ('reviewing', 'shortlisted', 'interview', 'offered', 'rejected')
         and new.status is distinct from old.status)
       or (old.status = 'offered' and new.status = 'rejected')
     ) then
    new.status_changed_at := pg_catalog.now();
    return new;
  end if;

  raise exception 'illegal application transition' using errcode = '42501';
end
$$;

drop trigger if exists applications_guard_write on public.applications;
create trigger applications_guard_write
  before insert or update on public.applications
  for each row execute function app.guard_application_write();

create or replace function app.guard_assignment_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null and v_role is distinct from 'service_role' then
      raise exception 'assignments cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'assignment changes are not client-writable' using errcode = '42501';
  end if;

  if current_setting('app.assignment_create', true) is distinct from 'accept' then
    raise exception 'assignments are created only when a worker accepts an offer' using errcode = '42501';
  end if;
  if new.status is distinct from 'confirmed'
     or new.worker_confirmed_at is null
     or new.employer_confirmed_at is null
     or new.application_id is null then
    raise exception 'accepted offers are confirmed assignments' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists assignments_guard_write on public.assignments;
create trigger assignments_guard_write
  before insert or update or delete on public.assignments
  for each row execute function app.guard_assignment_write();

revoke all on function app.looks_like_street(text) from public;
revoke all on function app.shift_period_of(timestamptz) from public;
revoke all on function app.pacific_timestamp(text) from public;
revoke all on function app.lookup_centroid(text, text, text) from public;
revoke all on function app.miles_between(numeric, numeric, numeric, numeric) from public;
revoke all on function app.ilike_contains(text, text) from public;
revoke all on function app.eligibility_block(uuid, boolean, timestamptz, uuid) from public;
revoke all on function app.job_block_reason(public.job_status, timestamptz, timestamptz, smallint, integer) from public;
revoke all on function app.active_assignment_count(uuid) from public;
revoke all on function app.notify_user(uuid, text, text, text, text, jsonb) from public;
revoke all on function app.audit_marketplace(uuid, text, text, uuid, uuid, jsonb, jsonb, text, text, text) from public;
revoke all on function app.guard_job_write() from public;
revoke all on function app.guard_application_write() from public;
revoke all on function app.guard_assignment_write() from public;

grant execute on function app.looks_like_street(text) to authenticated, service_role;
grant execute on function app.shift_period_of(timestamptz) to authenticated, service_role;
grant execute on function app.pacific_timestamp(text) to authenticated, service_role;
grant execute on function app.lookup_centroid(text, text, text) to authenticated, anon, service_role;
grant execute on function app.miles_between(numeric, numeric, numeric, numeric) to authenticated, anon, service_role;
grant execute on function app.ilike_contains(text, text) to authenticated, anon, service_role;
grant execute on function app.eligibility_block(uuid, boolean, timestamptz, uuid) to authenticated, anon, service_role;
grant execute on function app.job_block_reason(public.job_status, timestamptz, timestamptz, smallint, integer) to authenticated, service_role;
grant execute on function app.active_assignment_count(uuid) to authenticated, service_role;
grant execute on function app.guard_job_write() to authenticated, service_role;
grant execute on function app.guard_application_write() to authenticated, service_role;
grant execute on function app.guard_assignment_write() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Indexes for marketplace search. Private site_lat/site_lng index from
-- 0000 is unchanged and is not the public search key.
-- ---------------------------------------------------------------------
create index jobs_published_sort_idx on public.jobs (
  ((case urgency when 'urgent' then 0 when 'priority' then 1 else 2 end)),
  starts_at asc nulls last,
  published_at desc nulls last,
  id
) where status = 'published';

create index jobs_published_approx_idx
  on public.jobs (approx_lat, approx_lng)
  where status = 'published' and approx_lat is not null and approx_lng is not null;

create index jobs_published_city_idx
  on public.jobs (lower(city))
  where status = 'published';

create index jobs_published_county_idx
  on public.jobs (lower(county))
  where status = 'published';

create index jobs_published_shift_idx
  on public.jobs (shift_period, starts_at)
  where status = 'published';

-- ---------------------------------------------------------------------
-- Column privileges. Table SELECT is revoked, then public columns are
-- granted back. Private site fields stay unavailable to anon and
-- authenticated, including org members (they use job_private_site).
-- ---------------------------------------------------------------------
revoke select on table public.jobs from anon, authenticated;
grant select (
  id, organization_id, created_by, title, description, job_type, category, is_armed,
  status, urgency, city, county, postal_code, approx_lat, approx_lng, shift_period,
  starts_at, ends_at, recurrence_rule, pay_type, pay_min_cents, pay_max_cents,
  workers_needed, min_years_experience, uniform_notes, vehicle_required, equipment_notes,
  application_deadline, published_at, created_at, updated_at
) on table public.jobs to anon, authenticated;

revoke select on table public.organizations from anon;
grant select (
  id, name, org_type, website, description, verification_status, verified_at, service_counties
) on table public.organizations to anon;
revoke insert, update, delete, truncate on table public.organizations from anon;

create policy org_anon_verified_read on public.organizations
  for select to anon
  using (verification_status = 'verified');

-- Definer so job policies can see an applicant's own row without selecting
-- applications under RLS (that select would read jobs again and recurse).
create or replace function app.worker_has_job_access(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.applications a
    where a.job_id = p_job and a.worker_id = auth.uid()
  )
  or exists (
    select 1 from public.assignments s
    where s.job_id = p_job and s.worker_id = auth.uid()
  )
$$;

revoke all on function app.worker_has_job_access(uuid) from public;
grant execute on function app.worker_has_job_access(uuid) to authenticated, service_role;

-- Applicants can keep reading a shift after it leaves the public list.
create policy jobs_applicant_read on public.jobs
  for select to authenticated
  using (app.worker_has_job_access(id));

create policy jr_applicant_read on public.job_requirements
  for select to authenticated
  using (app.worker_has_job_access(job_id));

-- Direct inserts skip the credential and duplicate checks. submit_application is the only insert path.
drop policy if exists app_worker_insert on public.applications;

drop policy if exists sj_owner_all on public.saved_jobs;
create policy sj_owner_select on public.saved_jobs
  for select to authenticated
  using (worker_id = (select auth.uid()));
create policy sj_owner_delete on public.saved_jobs
  for delete to authenticated
  using (worker_id = (select auth.uid()));
create policy sj_owner_insert on public.saved_jobs
  for insert to authenticated
  with check (
    worker_id = (select auth.uid())
    and exists (
      select 1 from public.jobs j
      where j.id = job_id and j.status = 'published'
    )
  );

-- ---------------------------------------------------------------------
-- Organization + job writes
-- ---------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_org_type public.org_type,
  p_description text default null,
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
  v_type public.account_type;
  v_status public.account_status;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select account_type, status into v_type, v_status from public.profiles where id = v_uid;
  if v_type is distinct from 'employer' or v_status in ('suspended', 'deactivated') then
    raise exception 'account not active' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) > 200 then
    raise exception 'invalid organization name' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 5000 then
    raise exception 'description is too long' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'email not verified' using errcode = '42501';
  end if;

  insert into public.organizations (name, org_type, description, verification_status, created_by)
  values (v_name, p_org_type, v_description, 'unverified', v_uid)
  returning id into v_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_id, v_uid, 'owner_admin');

  update public.employer_profiles
     set primary_organization_id = v_id
   where user_id = v_uid and primary_organization_id is null;

  perform app.audit_marketplace(
    v_uid, 'organization.create', 'organization', v_id, v_id,
    null,
    jsonb_build_object('name', v_name, 'org_type', p_org_type, 'verification_status', 'unverified'),
    p_user_agent, p_request_id, p_ip
  );
  return v_id;
end
$$;

create or replace function public.save_job_draft(
  p_organization_id uuid,
  p_job_id uuid,
  p_title text,
  p_description text,
  p_job_type public.job_type,
  p_category public.security_category,
  p_is_armed boolean,
  p_urgency public.job_urgency,
  p_city text,
  p_county text,
  p_postal_code text,
  p_site_address_private text,
  p_site_lat numeric,
  p_site_lng numeric,
  p_approx_lat numeric,
  p_approx_lng numeric,
  p_starts_local text,
  p_ends_local text,
  p_pay_type public.pay_type,
  p_pay_min_cents integer,
  p_pay_max_cents integer,
  p_workers_needed smallint,
  p_min_years smallint,
  p_uniform_notes text,
  p_vehicle_required boolean,
  p_equipment_notes text,
  p_deadline_local text,
  p_required_codes text[],
  p_optional_codes text[],
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
  v_status public.account_status;
  v_id uuid := p_job_id;
  v_org uuid;
  v_job_status public.job_status;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_uniform text := nullif(btrim(coalesce(p_uniform_notes, '')), '');
  v_equipment text := nullif(btrim(coalesce(p_equipment_notes, '')), '');
  v_starts timestamptz;
  v_ends timestamptz;
  v_deadline timestamptz;
  v_needed smallint := coalesce(p_workers_needed, 1);
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select status into v_status from public.profiles where id = v_uid;
  if v_status in ('suspended', 'deactivated') then
    raise exception 'account not active' using errcode = '42501';
  end if;
  if not app.is_org_member(p_organization_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if v_title is null or char_length(v_title) < 3 or char_length(v_title) > 140 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  if v_description is null or char_length(v_description) > 10000 then
    raise exception 'invalid description' using errcode = '22023';
  end if;
  if p_pay_min_cents is not null and p_pay_min_cents < 0 then
    raise exception 'invalid pay' using errcode = '22023';
  end if;
  if p_pay_max_cents is not null and (p_pay_max_cents < 0 or (p_pay_min_cents is not null and p_pay_max_cents < p_pay_min_cents)) then
    raise exception 'invalid pay' using errcode = '22023';
  end if;
  if v_needed < 1 or v_needed > 500 then
    raise exception 'invalid headcount' using errcode = '22023';
  end if;
  if p_min_years is not null and (p_min_years < 0 or p_min_years > 70) then
    raise exception 'invalid experience' using errcode = '22023';
  end if;
  if v_uniform is not null and char_length(v_uniform) > 2000 then
    raise exception 'notes are too long' using errcode = '22023';
  end if;
  if v_equipment is not null and char_length(v_equipment) > 2000 then
    raise exception 'notes are too long' using errcode = '22023';
  end if;
  if (p_site_lat is null) is distinct from (p_site_lng is null) then
    raise exception 'site pin needs both coordinates' using errcode = '22023';
  end if;
  if (p_approx_lat is null) is distinct from (p_approx_lng is null) then
    raise exception 'approximate point needs both coordinates' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_required_codes), 0) > 20 or coalesce(cardinality(p_optional_codes), 0) > 20 then
    raise exception 'too many credentials' using errcode = '22023';
  end if;

  v_starts := app.pacific_timestamp(p_starts_local);
  v_ends := app.pacific_timestamp(p_ends_local);
  v_deadline := app.pacific_timestamp(p_deadline_local);
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    raise exception 'end must be after start' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_required_codes, '{}'::text[]) || coalesce(p_optional_codes, '{}'::text[])) c(code)
    where nullif(btrim(c.code), '') is not null
      and not exists (select 1 from public.credential_types t where t.code = btrim(c.code) and t.is_active)
  ) then
    raise exception 'unknown credential' using errcode = '22023';
  end if;

  if p_job_id is null then
    insert into public.jobs (
      organization_id, created_by, title, description, job_type, category, is_armed, status, urgency,
      city, county, postal_code, site_address_private, site_lat, site_lng, approx_lat, approx_lng,
      starts_at, ends_at, pay_type, pay_min_cents, pay_max_cents, workers_needed, min_years_experience,
      uniform_notes, vehicle_required, equipment_notes, application_deadline
    ) values (
      p_organization_id, v_uid, v_title, v_description, p_job_type, p_category, coalesce(p_is_armed, false), 'draft', coalesce(p_urgency, 'normal'),
      p_city, p_county, p_postal_code, p_site_address_private, p_site_lat, p_site_lng, p_approx_lat, p_approx_lng,
      v_starts, v_ends, p_pay_type, p_pay_min_cents, p_pay_max_cents, v_needed, p_min_years,
      v_uniform, coalesce(p_vehicle_required, false), v_equipment, v_deadline
    ) returning id into v_id;
  else
    select organization_id, status into v_org, v_job_status
    from public.jobs where id = p_job_id for update;
    if not found or v_org is distinct from p_organization_id then
      raise exception 'job not found' using errcode = '42501';
    end if;
    if v_job_status not in ('draft', 'pending_review') then
      raise exception 'job is locked' using errcode = '42501';
    end if;
    update public.jobs set
      title = v_title,
      description = v_description,
      job_type = p_job_type,
      category = p_category,
      is_armed = coalesce(p_is_armed, false),
      urgency = coalesce(p_urgency, 'normal'),
      city = p_city,
      county = p_county,
      postal_code = p_postal_code,
      site_address_private = p_site_address_private,
      site_lat = p_site_lat,
      site_lng = p_site_lng,
      approx_lat = p_approx_lat,
      approx_lng = p_approx_lng,
      starts_at = v_starts,
      ends_at = v_ends,
      pay_type = p_pay_type,
      pay_min_cents = p_pay_min_cents,
      pay_max_cents = p_pay_max_cents,
      workers_needed = v_needed,
      min_years_experience = p_min_years,
      uniform_notes = v_uniform,
      vehicle_required = coalesce(p_vehicle_required, false),
      equipment_notes = v_equipment,
      application_deadline = v_deadline
    where id = p_job_id;
    delete from public.job_requirements where job_id = p_job_id;
  end if;

  insert into public.job_requirements (job_id, credential_type_id, is_mandatory)
  select v_id, t.id, true
  from public.credential_types t
  where t.is_active and t.code = any (coalesce(p_required_codes, '{}'::text[]));

  insert into public.job_requirements (job_id, credential_type_id, is_mandatory)
  select v_id, t.id, false
  from public.credential_types t
  where t.is_active
    and t.code = any (coalesce(p_optional_codes, '{}'::text[]))
    and not (t.code = any (coalesce(p_required_codes, '{}'::text[])));

  perform app.audit_marketplace(
    v_uid, 'job.save', 'job', v_id, p_organization_id,
    null,
    jsonb_build_object('title', v_title, 'status', coalesce(v_job_status, 'draft'), 'city', nullif(btrim(coalesce(p_city, '')), ''), 'is_armed', coalesce(p_is_armed, false), 'pay_min_cents', p_pay_min_cents),
    p_user_agent, p_request_id, p_ip
  );
  return v_id;
end
$$;

create or replace function public.publish_job(
  p_job_id uuid,
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
  v_account public.account_status;
  v_job public.jobs%rowtype;
  v_org_status public.verification_status;
  v_next public.job_status;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select status into v_account from public.profiles where id = v_uid;
  if v_account in ('suspended', 'deactivated') then
    raise exception 'account not active' using errcode = '42501';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = '42501';
  end if;
  if not app.is_org_member(v_job.organization_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if v_job.status = 'published' then
    return 'published';
  end if;
  if v_job.status not in ('draft', 'pending_review') then
    raise exception 'job is not open' using errcode = '42501';
  end if;
  if v_job.pay_min_cents is null then
    raise exception 'pay required' using errcode = '22023';
  end if;
  if v_job.job_type in ('single_shift', 'multi_day', 'recurring') and v_job.starts_at is null then
    raise exception 'start time required' using errcode = '22023';
  end if;
  if v_job.approx_lat is null or v_job.approx_lng is null
     or (nullif(btrim(coalesce(v_job.city, '')), '') is null and nullif(btrim(coalesce(v_job.postal_code, '')), '') is null) then
    raise exception 'location required' using errcode = '22023';
  end if;

  select verification_status into v_org_status from public.organizations where id = v_job.organization_id;
  v_next := case when v_org_status = 'verified' then 'published'::public.job_status else 'pending_review'::public.job_status end;

  perform set_config('app.job_status_transition', 'publish', true);
  update public.jobs
     set status = v_next,
         published_at = case when v_next = 'published' then pg_catalog.now() else published_at end
   where id = p_job_id;

  perform app.audit_marketplace(
    v_uid, 'job.publish', 'job', p_job_id, v_job.organization_id,
    jsonb_build_object('status', v_job.status),
    jsonb_build_object('status', v_next, 'organization_verification', v_org_status),
    p_user_agent, p_request_id, p_ip
  );
  return v_next;
end
$$;

-- ---------------------------------------------------------------------
-- Search. Security invoker so RLS still hides unpublished rows.
-- Distance uses approximate coordinates only.
-- ---------------------------------------------------------------------
create or replace function public.search_jobs(
  p_lat numeric default null,
  p_lng numeric default null,
  p_radius_miles numeric default null,
  p_city text default null,
  p_county text default null,
  p_pay_min_cents integer default null,
  p_on_date date default null,
  p_shift text default null,
  p_window_start time default null,
  p_window_end time default null,
  p_category public.security_category default null,
  p_armed boolean default null,
  p_credential_code text default null,
  p_min_years smallint default null,
  p_organization_id uuid default null,
  p_job_type public.job_type default null,
  p_employer text default null,
  p_eligible_only boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
) returns table (
  id uuid,
  title text,
  summary text,
  job_type public.job_type,
  category public.security_category,
  is_armed boolean,
  urgency public.job_urgency,
  city text,
  county text,
  postal_code text,
  shift_period text,
  starts_at timestamptz,
  ends_at timestamptz,
  pay_type public.pay_type,
  pay_min_cents integer,
  pay_max_cents integer,
  workers_needed smallint,
  min_years_experience smallint,
  vehicle_required boolean,
  organization_id uuid,
  employer_name text,
  employer_verified boolean,
  distance_miles numeric,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      case
        when p_lat is null or p_lng is null or p_radius_miles is null then null::numeric
        when p_lat not between -90 and 90 or p_lng not between -180 and 180 then null::numeric
        else least(greatest(p_radius_miles, 1), 500)
      end as radius_mi,
      nullif(btrim(coalesce(p_city, '')), '') as city,
      nullif(btrim(coalesce(p_county, '')), '') as county,
      nullif(btrim(coalesce(p_employer, '')), '') as employer,
      nullif(btrim(coalesce(p_credential_code, '')), '') as credential_code,
      case when p_shift in ('day', 'swing', 'night') then p_shift else null::text end as shift,
      case
        when p_on_date is null then null::timestamptz
        else (p_on_date::timestamp) at time zone 'America/Los_Angeles'
      end as day_start
  )
  select
    j.id,
    j.title,
    left(j.description, 180) as summary,
    j.job_type,
    j.category,
    j.is_armed,
    j.urgency,
    j.city,
    j.county,
    j.postal_code,
    j.shift_period,
    j.starts_at,
    j.ends_at,
    j.pay_type,
    j.pay_min_cents,
    j.pay_max_cents,
    j.workers_needed,
    j.min_years_experience,
    j.vehicle_required,
    j.organization_id,
    o.name as employer_name,
    (o.verification_status = 'verified') as employer_verified,
    case
      when params.radius_mi is null then null::numeric
      else app.miles_between(p_lat, p_lng, j.approx_lat, j.approx_lng)
    end as distance_miles,
    count(*) over () as total_count
  from public.jobs j
  cross join params
  left join public.organizations o on o.id = j.organization_id
  where j.status = 'published'
    and (params.city is null or lower(j.city) = lower(params.city))
    and (params.county is null or lower(j.county) = lower(params.county))
    and (p_pay_min_cents is null or j.pay_min_cents >= p_pay_min_cents)
    and (p_category is null or j.category = p_category)
    and (p_armed is null or j.is_armed = p_armed)
    and (p_job_type is null or j.job_type = p_job_type)
    and (p_organization_id is null or j.organization_id = p_organization_id)
    and (p_min_years is null or j.min_years_experience is null or j.min_years_experience <= p_min_years)
    and (params.shift is null or j.shift_period = params.shift)
    and (
      params.day_start is null
      or (
        j.starts_at < params.day_start + interval '1 day'
        and coalesce(j.ends_at, j.starts_at) >= params.day_start
      )
    )
    and (
      p_window_start is null or p_window_end is null or j.starts_at is null
      or (
        case
          when p_window_start <= p_window_end then
            (j.starts_at at time zone 'America/Los_Angeles')::time >= p_window_start
            and (j.starts_at at time zone 'America/Los_Angeles')::time < p_window_end
          else
            (j.starts_at at time zone 'America/Los_Angeles')::time >= p_window_start
            or (j.starts_at at time zone 'America/Los_Angeles')::time < p_window_end
        end
      )
    )
    and (
      params.credential_code is null
      or exists (
        select 1
        from public.job_requirements jr
        join public.credential_types t on t.id = jr.credential_type_id
        where jr.job_id = j.id and t.code = params.credential_code
      )
    )
    and (params.employer is null or app.ilike_contains(o.name, params.employer))
    and (
      params.radius_mi is null
      or (
        j.approx_lat between p_lat - (params.radius_mi / 69.0) and p_lat + (params.radius_mi / 69.0)
        and j.approx_lng between p_lng - (params.radius_mi / (69.0 * greatest(cos(radians(p_lat)), 0.2)))
                              and p_lng + (params.radius_mi / (69.0 * greatest(cos(radians(p_lat)), 0.2)))
        and app.miles_between(p_lat, p_lng, j.approx_lat, j.approx_lng) <= params.radius_mi
      )
    )
    and (
      not coalesce(p_eligible_only, false)
      or (
        (select auth.uid()) is not null
        and app.eligibility_block((select auth.uid()), j.is_armed, j.starts_at, j.id) is null
      )
    )
  order by
    case j.urgency when 'urgent' then 0 when 'priority' then 1 else 2 end,
    j.starts_at asc nulls last,
    j.published_at desc nulls last,
    j.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000)
$$;

create or replace function public.job_private_site(p_job_id uuid)
returns table (site_address_private text, site_lat numeric, site_lng numeric)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    return;
  end if;
  select j.organization_id into v_org from public.jobs j where j.id = p_job_id;
  if not found then
    return;
  end if;
  if not (
    app.is_org_member(v_org)
    or app.is_staff()
    or exists (
      select 1 from public.assignments s
      where s.job_id = p_job_id
        and s.worker_id = v_uid
        and s.status in ('pending_confirmation', 'confirmed', 'in_progress', 'completed', 'disputed')
    )
  ) then
    return;
  end if;
  return query
  select j.site_address_private, j.site_lat, j.site_lng
  from public.jobs j
  where j.id = p_job_id;
end
$$;

create or replace function public.job_applicants(p_job_id uuid)
returns table (
  application_id uuid,
  status public.application_status,
  cover_note text,
  submitted_at timestamptz,
  worker_id uuid,
  display_name text,
  city text,
  county text,
  years_experience smallint,
  verified_credentials jsonb
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select j.organization_id into v_org from public.jobs j where j.id = p_job_id;
  if not found or not app.is_org_member(v_org) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    a.status,
    a.cover_note,
    a.created_at,
    a.worker_id,
    p.display_name,
    wp.city,
    wp.county,
    wp.years_experience,
    coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'expires_on', s.expires_on) order by s.name)
      from (
        select distinct on (t.code) t.code, t.name, c.expires_on
        from public.credentials c
        join public.credential_types t on t.id = c.credential_type_id
        where c.worker_id = a.worker_id and c.status = 'verified'
        order by t.code, c.expires_on desc nulls first
      ) s
    ), '[]'::jsonb)
  from public.applications a
  join public.profiles p on p.id = a.worker_id
  left join public.worker_profiles wp on wp.user_id = a.worker_id
  where a.job_id = p_job_id
  order by a.created_at desc
  limit 200;
end
$$;

-- ---------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------
create or replace function public.submit_application(
  p_job_id uuid,
  p_note text default null,
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
  v_type public.account_type;
  v_status public.account_status;
  v_job public.jobs%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_block text;
  v_id uuid;
  v_filled integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select account_type, status into v_type, v_status from public.profiles where id = v_uid;
  if v_type is distinct from 'worker' or v_status in ('suspended', 'deactivated') then
    raise exception 'worker profile required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.worker_profiles w where w.user_id = v_uid) then
    raise exception 'worker profile required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'email not verified' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 4000 then
    raise exception 'note too long' using errcode = '22023';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job is not open' using errcode = '42501';
  end if;
  v_filled := app.active_assignment_count(p_job_id);
  v_block := app.job_block_reason(v_job.status, v_job.application_deadline, v_job.ends_at, v_job.workers_needed, v_filled);
  if v_block is not null then
    raise exception '%', v_block using errcode = '42501';
  end if;
  if exists (select 1 from public.applications a where a.job_id = p_job_id and a.worker_id = v_uid) then
    raise exception 'already applied' using errcode = '23505';
  end if;
  v_block := app.eligibility_block(v_uid, v_job.is_armed, v_job.starts_at, p_job_id);
  if v_block is not null then
    raise exception '%', v_block using errcode = '42501';
  end if;

  perform set_config('app.application_transition', 'submit', true);
  insert into public.applications (job_id, worker_id, status, cover_note, submitted_via)
  values (p_job_id, v_uid, 'submitted', v_note, 'user')
  returning id into v_id;

  perform app.audit_marketplace(
    v_uid, 'application.submit', 'application', v_id, v_job.organization_id,
    null,
    jsonb_build_object('status', 'submitted', 'job_id', p_job_id),
    p_user_agent, p_request_id, p_ip
  );

  insert into public.notifications (user_id, event_type, title, body, link_path, data)
  select m.user_id, 'application_received', 'New application',
         'A worker applied to ' || left(v_job.title, 80) || '.',
         '/employer/jobs/' || p_job_id::text,
         jsonb_build_object('application_id', v_id, 'job_id', p_job_id)
  from public.organization_members m
  where m.organization_id = v_job.organization_id;

  return v_id;
end
$$;

create or replace function public.withdraw_application(
  p_application_id uuid,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns public.application_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_worker uuid;
  v_status public.application_status;
  v_job uuid;
  v_org uuid;
  v_title text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select a.worker_id, a.status, a.job_id into v_worker, v_status, v_job
  from public.applications a where a.id = p_application_id for update;
  if not found or v_worker is distinct from v_uid then
    raise exception 'application not found' using errcode = '42501';
  end if;
  select j.organization_id, j.title into v_org, v_title from public.jobs j where j.id = v_job;

  perform set_config('app.application_transition', 'withdraw', true);
  update public.applications set status = 'withdrawn' where id = p_application_id;

  perform app.audit_marketplace(
    v_uid, 'application.withdraw', 'application', p_application_id, v_org,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'withdrawn', 'job_id', v_job),
    p_user_agent, p_request_id, p_ip
  );
  insert into public.notifications (user_id, event_type, title, body, link_path, data)
  select m.user_id, 'application_withdrawn', 'Application withdrawn',
         'A worker withdrew an application for ' || left(coalesce(v_title, 'a shift'), 80) || '.',
         '/employer/jobs/' || v_job::text,
         jsonb_build_object('application_id', p_application_id, 'job_id', v_job)
  from public.organization_members m
  where m.organization_id = v_org;
  return 'withdrawn';
end
$$;

create or replace function public.employer_set_application_status(
  p_application_id uuid,
  p_status public.application_status,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns public.application_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_account public.account_status;
  v_worker uuid;
  v_status public.application_status;
  v_job uuid;
  v_org uuid;
  v_title text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select status into v_account from public.profiles where id = v_uid;
  if v_account in ('suspended', 'deactivated') then
    raise exception 'account not active' using errcode = '42501';
  end if;
  if p_status not in ('reviewing', 'shortlisted', 'interview', 'offered', 'rejected') then
    raise exception 'illegal application transition' using errcode = '42501';
  end if;

  select a.worker_id, a.status, a.job_id into v_worker, v_status, v_job
  from public.applications a where a.id = p_application_id for update;
  if not found then
    raise exception 'application not found' using errcode = '42501';
  end if;
  select j.organization_id, j.title into v_org, v_title from public.jobs j where j.id = v_job;
  if not app.is_org_member(v_org) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  perform set_config('app.application_transition', 'employer', true);
  update public.applications set status = p_status where id = p_application_id;

  perform app.audit_marketplace(
    v_uid, 'application.review', 'application', p_application_id, v_org,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', p_status, 'job_id', v_job),
    p_user_agent, p_request_id, p_ip
  );
  perform app.notify_user(
    v_worker,
    'application_status',
    'Application update',
    'Your application for ' || left(coalesce(v_title, 'a shift'), 80) || ' is now ' || p_status::text || '.',
    '/worker/applications/' || p_application_id::text,
    jsonb_build_object('application_id', p_application_id, 'job_id', v_job, 'status', p_status)
  );
  return p_status;
end
$$;

create or replace function public.decline_offer(
  p_application_id uuid,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns public.application_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_worker uuid;
  v_status public.application_status;
  v_job uuid;
  v_org uuid;
  v_title text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select a.worker_id, a.status, a.job_id into v_worker, v_status, v_job
  from public.applications a where a.id = p_application_id for update;
  if not found or v_worker is distinct from v_uid then
    raise exception 'application not found' using errcode = '42501';
  end if;
  select j.organization_id, j.title into v_org, v_title from public.jobs j where j.id = v_job;

  perform set_config('app.application_transition', 'decline', true);
  update public.applications set status = 'declined' where id = p_application_id;

  perform app.audit_marketplace(
    v_uid, 'application.decline', 'application', p_application_id, v_org,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'declined', 'job_id', v_job),
    p_user_agent, p_request_id, p_ip
  );
  insert into public.notifications (user_id, event_type, title, body, link_path, data)
  select m.user_id, 'application_declined', 'Offer declined',
         'A worker declined the offer for ' || left(coalesce(v_title, 'a shift'), 80) || '.',
         '/employer/jobs/' || v_job::text,
         jsonb_build_object('application_id', p_application_id, 'job_id', v_job)
  from public.organization_members m
  where m.organization_id = v_org;
  return 'declined';
end
$$;

create or replace function public.accept_offer(
  p_application_id uuid,
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
  v_worker uuid;
  v_status public.application_status;
  v_job public.jobs%rowtype;
  v_job_id uuid;
  v_filled integer;
  v_block text;
  v_assignment uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select a.worker_id, a.status, a.job_id into v_worker, v_status, v_job_id
  from public.applications a where a.id = p_application_id for update;
  if not found or v_worker is distinct from v_uid then
    raise exception 'application not found' using errcode = '42501';
  end if;

  select * into v_job from public.jobs where id = v_job_id for update;
  v_filled := app.active_assignment_count(v_job_id);
  v_block := app.job_block_reason(v_job.status, v_job.application_deadline, v_job.ends_at, v_job.workers_needed, v_filled);
  if v_block is not null then
    raise exception '%', v_block using errcode = '42501';
  end if;

  perform set_config('app.application_transition', 'accept', true);
  update public.applications set status = 'accepted' where id = p_application_id;

  perform set_config('app.assignment_create', 'accept', true);
  insert into public.assignments (
    job_id, application_id, worker_id, organization_id, status, starts_at, ends_at, worker_confirmed_at, employer_confirmed_at
  ) values (
    v_job.id, p_application_id, v_uid, v_job.organization_id, 'confirmed', v_job.starts_at, v_job.ends_at, pg_catalog.now(), pg_catalog.now()
  ) returning id into v_assignment;

  perform app.audit_marketplace(
    v_uid, 'application.accept', 'application', p_application_id, v_job.organization_id,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'accepted', 'job_id', v_job.id, 'assignment_id', v_assignment),
    p_user_agent, p_request_id, p_ip
  );
  perform app.audit_marketplace(
    v_uid, 'assignment.create', 'assignment', v_assignment, v_job.organization_id,
    null,
    jsonb_build_object('status', 'confirmed', 'job_id', v_job.id, 'application_id', p_application_id),
    p_user_agent, p_request_id, p_ip
  );

  insert into public.notifications (user_id, event_type, title, body, link_path, data)
  select m.user_id, 'application_accepted', 'Offer accepted',
         'A worker accepted the offer for ' || left(v_job.title, 80) || '.',
         '/employer/jobs/' || v_job.id::text,
         jsonb_build_object('application_id', p_application_id, 'job_id', v_job.id, 'assignment_id', v_assignment)
  from public.organization_members m
  where m.organization_id = v_job.organization_id;

  return v_assignment;
end
$$;

revoke all on function public.create_organization(text, public.org_type, text, text, text, text) from public, anon;
revoke all on function public.save_job_draft(uuid, uuid, text, text, public.job_type, public.security_category, boolean, public.job_urgency, text, text, text, text, numeric, numeric, numeric, numeric, text, text, public.pay_type, integer, integer, smallint, smallint, text, boolean, text, text, text[], text[], text, text, text) from public, anon;
revoke all on function public.publish_job(uuid, text, text, text) from public, anon;
revoke all on function public.search_jobs(numeric, numeric, numeric, text, text, integer, date, text, time, time, public.security_category, boolean, text, smallint, uuid, public.job_type, text, boolean, integer, integer) from public, anon;
revoke all on function public.job_private_site(uuid) from public, anon;
revoke all on function public.job_applicants(uuid) from public, anon;
revoke all on function public.submit_application(uuid, text, text, text, text) from public, anon;
revoke all on function public.withdraw_application(uuid, text, text, text) from public, anon;
revoke all on function public.employer_set_application_status(uuid, public.application_status, text, text, text) from public, anon;
revoke all on function public.decline_offer(uuid, text, text, text) from public, anon;
revoke all on function public.accept_offer(uuid, text, text, text) from public, anon;

grant execute on function public.create_organization(text, public.org_type, text, text, text, text) to authenticated;
grant execute on function public.save_job_draft(uuid, uuid, text, text, public.job_type, public.security_category, boolean, public.job_urgency, text, text, text, text, numeric, numeric, numeric, numeric, text, text, public.pay_type, integer, integer, smallint, smallint, text, boolean, text, text, text[], text[], text, text, text) to authenticated;
grant execute on function public.publish_job(uuid, text, text, text) to authenticated;
grant execute on function public.search_jobs(numeric, numeric, numeric, text, text, integer, date, text, time, time, public.security_category, boolean, text, smallint, uuid, public.job_type, text, boolean, integer, integer) to anon, authenticated;
grant execute on function public.job_private_site(uuid) to authenticated;
grant execute on function public.job_applicants(uuid) to authenticated;
grant execute on function public.submit_application(uuid, text, text, text, text) to authenticated;
grant execute on function public.withdraw_application(uuid, text, text, text) to authenticated;
grant execute on function public.employer_set_application_status(uuid, public.application_status, text, text, text) to authenticated;
grant execute on function public.decline_offer(uuid, text, text, text) to authenticated;
grant execute on function public.accept_offer(uuid, text, text, text) to authenticated;

comment on function public.search_jobs(numeric, numeric, numeric, text, text, integer, date, text, time, time, public.security_category, boolean, text, smallint, uuid, public.job_type, text, boolean, integer, integer) is
  'Published-shift search. Radius uses rounded approximate coordinates and haversine miles. Eligible-for-me uses the caller''s verified credentials only.';
comment on function public.accept_offer(uuid, text, text, text) is
  'Worker accepts an offer. This is the only path that inserts an assignment.';
comment on function public.job_private_site(uuid) is
  'Returns the private site only to org members, staff, or workers with an active assignment.';

-- ---------------------------------------------------------------------
-- Centroid seed. ON CONFLICT DO NOTHING so a restored database can re-run
-- the inserts if the unique indexes already hold the same keys.
-- Coordinates are approximate public centers rounded to 4 decimal degrees.
-- ---------------------------------------------------------------------
insert into public.place_centroids (city, county, label, lat, lng, source)
values
  ('Los Angeles', 'Los Angeles', 'Los Angeles', 34.0522, -118.2437, 'city_centroid'),
  ('San Diego', 'San Diego', 'San Diego', 32.7157, -117.1611, 'city_centroid'),
  ('San Jose', 'Santa Clara', 'San Jose', 37.3382, -121.8863, 'city_centroid'),
  ('San Francisco', 'San Francisco', 'San Francisco', 37.7749, -122.4194, 'city_centroid'),
  ('Fresno', 'Fresno', 'Fresno', 36.7378, -119.7871, 'city_centroid'),
  ('Sacramento', 'Sacramento', 'Sacramento', 38.5816, -121.4944, 'city_centroid'),
  ('Long Beach', 'Los Angeles', 'Long Beach', 33.7701, -118.1937, 'city_centroid'),
  ('Oakland', 'Alameda', 'Oakland', 37.8044, -122.2712, 'city_centroid'),
  ('Bakersfield', 'Kern', 'Bakersfield', 35.3733, -119.0187, 'city_centroid'),
  ('Anaheim', 'Orange', 'Anaheim', 33.8366, -117.9143, 'city_centroid'),
  ('Stockton', 'San Joaquin', 'Stockton', 37.9577, -121.2908, 'city_centroid'),
  ('Riverside', 'Riverside', 'Riverside', 33.9806, -117.3755, 'city_centroid'),
  ('Irvine', 'Orange', 'Irvine', 33.6846, -117.8265, 'city_centroid'),
  ('Santa Ana', 'Orange', 'Santa Ana', 33.7455, -117.8677, 'city_centroid'),
  ('Chula Vista', 'San Diego', 'Chula Vista', 32.6401, -117.0842, 'city_centroid'),
  ('Fremont', 'Alameda', 'Fremont', 37.5485, -121.9886, 'city_centroid'),
  ('San Bernardino', 'San Bernardino', 'San Bernardino', 34.1083, -117.2898, 'city_centroid'),
  ('Modesto', 'Stanislaus', 'Modesto', 37.6391, -120.9969, 'city_centroid'),
  ('Fontana', 'San Bernardino', 'Fontana', 34.0922, -117.4350, 'city_centroid'),
  ('Moreno Valley', 'Riverside', 'Moreno Valley', 33.9425, -117.2297, 'city_centroid'),
  ('Oxnard', 'Ventura', 'Oxnard', 34.1975, -119.1771, 'city_centroid'),
  ('Huntington Beach', 'Orange', 'Huntington Beach', 33.6595, -117.9988, 'city_centroid'),
  ('Glendale', 'Los Angeles', 'Glendale', 34.1425, -118.2551, 'city_centroid'),
  ('Santa Clarita', 'Los Angeles', 'Santa Clarita', 34.3917, -118.5426, 'city_centroid'),
  ('Garden Grove', 'Orange', 'Garden Grove', 33.7739, -117.9414, 'city_centroid'),
  ('Oceanside', 'San Diego', 'Oceanside', 33.1959, -117.3795, 'city_centroid'),
  ('Rancho Cucamonga', 'San Bernardino', 'Rancho Cucamonga', 34.1064, -117.5931, 'city_centroid'),
  ('Ontario', 'San Bernardino', 'Ontario', 34.0633, -117.6509, 'city_centroid'),
  ('Santa Rosa', 'Sonoma', 'Santa Rosa', 38.4404, -122.7141, 'city_centroid'),
  ('Elk Grove', 'Sacramento', 'Elk Grove', 38.4088, -121.3716, 'city_centroid'),
  ('Corona', 'Riverside', 'Corona', 33.8753, -117.5664, 'city_centroid'),
  ('Lancaster', 'Los Angeles', 'Lancaster', 34.6868, -118.1542, 'city_centroid'),
  ('Palmdale', 'Los Angeles', 'Palmdale', 34.5794, -118.1165, 'city_centroid'),
  ('Salinas', 'Monterey', 'Salinas', 36.6777, -121.6555, 'city_centroid'),
  ('Hayward', 'Alameda', 'Hayward', 37.6688, -122.0808, 'city_centroid'),
  ('Pomona', 'Los Angeles', 'Pomona', 34.0551, -117.7500, 'city_centroid'),
  ('Escondido', 'San Diego', 'Escondido', 33.1192, -117.0864, 'city_centroid'),
  ('Sunnyvale', 'Santa Clara', 'Sunnyvale', 37.3688, -122.0363, 'city_centroid'),
  ('Torrance', 'Los Angeles', 'Torrance', 33.8358, -118.3406, 'city_centroid'),
  ('Pasadena', 'Los Angeles', 'Pasadena', 34.1478, -118.1445, 'city_centroid'),
  ('Orange', 'Orange', 'Orange', 33.7879, -117.8531, 'city_centroid'),
  ('Fullerton', 'Orange', 'Fullerton', 33.8704, -117.9242, 'city_centroid'),
  ('Thousand Oaks', 'Ventura', 'Thousand Oaks', 34.1706, -118.8376, 'city_centroid'),
  ('Visalia', 'Tulare', 'Visalia', 36.3302, -119.2921, 'city_centroid'),
  ('Roseville', 'Placer', 'Roseville', 38.7521, -121.2880, 'city_centroid'),
  ('Concord', 'Contra Costa', 'Concord', 37.9780, -122.0311, 'city_centroid'),
  ('Simi Valley', 'Ventura', 'Simi Valley', 34.2694, -118.7815, 'city_centroid'),
  ('Santa Clara', 'Santa Clara', 'Santa Clara', 37.3541, -121.9552, 'city_centroid'),
  ('Victorville', 'San Bernardino', 'Victorville', 34.5361, -117.2928, 'city_centroid'),
  ('Vallejo', 'Solano', 'Vallejo', 38.1041, -122.2566, 'city_centroid'),
  ('Berkeley', 'Alameda', 'Berkeley', 37.8715, -122.2730, 'city_centroid'),
  ('Downey', 'Los Angeles', 'Downey', 33.9401, -118.1332, 'city_centroid'),
  ('Costa Mesa', 'Orange', 'Costa Mesa', 33.6411, -117.9187, 'city_centroid'),
  ('Inglewood', 'Los Angeles', 'Inglewood', 33.9617, -118.3531, 'city_centroid'),
  ('Carlsbad', 'San Diego', 'Carlsbad', 33.1581, -117.3506, 'city_centroid'),
  ('Ventura', 'Ventura', 'Ventura', 34.2805, -119.2945, 'city_centroid'),
  ('Fairfield', 'Solano', 'Fairfield', 38.2494, -122.0400, 'city_centroid'),
  ('Richmond', 'Contra Costa', 'Richmond', 37.9358, -122.3477, 'city_centroid'),
  ('Antioch', 'Contra Costa', 'Antioch', 37.9810, -121.7958, 'city_centroid'),
  ('Temecula', 'Riverside', 'Temecula', 33.4936, -117.1484, 'city_centroid'),
  ('Daly City', 'San Mateo', 'Daly City', 37.6879, -122.4702, 'city_centroid'),
  ('Burbank', 'Los Angeles', 'Burbank', 34.1808, -118.3090, 'city_centroid'),
  ('San Mateo', 'San Mateo', 'San Mateo', 37.5630, -122.3255, 'city_centroid'),
  ('El Cajon', 'San Diego', 'El Cajon', 32.7948, -116.9625, 'city_centroid'),
  ('Clovis', 'Fresno', 'Clovis', 36.8252, -119.7029, 'city_centroid'),
  ('Compton', 'Los Angeles', 'Compton', 33.8958, -118.2201, 'city_centroid'),
  ('Vista', 'San Diego', 'Vista', 33.2000, -117.2425, 'city_centroid'),
  ('South Gate', 'Los Angeles', 'South Gate', 33.9547, -118.2120, 'city_centroid'),
  ('Vacaville', 'Solano', 'Vacaville', 38.3566, -121.9877, 'city_centroid'),
  ('Redding', 'Shasta', 'Redding', 40.5865, -122.3917, 'city_centroid'),
  ('Santa Monica', 'Los Angeles', 'Santa Monica', 34.0195, -118.4912, 'city_centroid'),
  ('Santa Barbara', 'Santa Barbara', 'Santa Barbara', 34.4208, -119.6982, 'city_centroid'),
  ('Chico', 'Butte', 'Chico', 39.7285, -121.8375, 'city_centroid'),
  ('Newport Beach', 'Orange', 'Newport Beach', 33.6189, -117.9289, 'city_centroid'),
  ('San Leandro', 'Alameda', 'San Leandro', 37.7249, -122.1561, 'city_centroid'),
  ('Tracy', 'San Joaquin', 'Tracy', 37.7397, -121.4252, 'city_centroid'),
  ('Livermore', 'Alameda', 'Livermore', 37.6819, -121.7680, 'city_centroid'),
  ('Merced', 'Merced', 'Merced', 37.3022, -120.4830, 'city_centroid'),
  ('Indio', 'Riverside', 'Indio', 33.7206, -116.2156, 'city_centroid'),
  ('Redwood City', 'San Mateo', 'Redwood City', 37.4852, -122.2364, 'city_centroid'),
  ('Napa', 'Napa', 'Napa', 38.5025, -122.2654, 'city_centroid'),
  ('Mountain View', 'Santa Clara', 'Mountain View', 37.3861, -122.0839, 'city_centroid'),
  ('Alameda', 'Alameda', 'Alameda', 37.7652, -122.2416, 'city_centroid'),
  ('Milpitas', 'Santa Clara', 'Milpitas', 37.4323, -121.8996, 'city_centroid'),
  ('Pleasanton', 'Alameda', 'Pleasanton', 37.6624, -121.8747, 'city_centroid'),
  ('Folsom', 'Sacramento', 'Folsom', 38.6780, -121.1761, 'city_centroid'),
  ('San Ramon', 'Contra Costa', 'San Ramon', 37.7799, -121.9780, 'city_centroid'),
  ('Palo Alto', 'Santa Clara', 'Palo Alto', 37.4419, -122.1430, 'city_centroid'),
  ('Walnut Creek', 'Contra Costa', 'Walnut Creek', 37.9101, -122.0652, 'city_centroid'),
  ('Yuba City', 'Sutter', 'Yuba City', 39.1404, -121.6169, 'city_centroid'),
  ('Manteca', 'San Joaquin', 'Manteca', 37.7974, -121.2161, 'city_centroid'),
  ('Davis', 'Yolo', 'Davis', 38.5449, -121.7405, 'city_centroid'),
  ('San Luis Obispo', 'San Luis Obispo', 'San Luis Obispo', 35.2828, -120.6596, 'city_centroid'),
  ('Monterey', 'Monterey', 'Monterey', 36.6002, -121.8947, 'city_centroid'),
  ('Santa Cruz', 'Santa Cruz', 'Santa Cruz', 36.9741, -122.0308, 'city_centroid'),
  ('Eureka', 'Humboldt', 'Eureka', 40.8021, -124.1637, 'city_centroid'),
  ('Ukiah', 'Mendocino', 'Ukiah', 39.1502, -123.2078, 'city_centroid'),
  ('Petaluma', 'Sonoma', 'Petaluma', 38.2324, -122.6367, 'city_centroid'),
  ('San Rafael', 'Marin', 'San Rafael', 37.9735, -122.5311, 'city_centroid'),
  ('Novato', 'Marin', 'Novato', 38.1074, -122.5697, 'city_centroid'),
  ('Palm Springs', 'Riverside', 'Palm Springs', 33.8303, -116.5453, 'city_centroid'),
  ('Hemet', 'Riverside', 'Hemet', 33.7475, -116.9719, 'city_centroid'),
  ('Madera', 'Madera', 'Madera', 36.9613, -120.0607, 'city_centroid'),
  ('Hollister', 'San Benito', 'Hollister', 36.8525, -121.4016, 'city_centroid'),
  ('Martinez', 'Contra Costa', 'Martinez', 38.0194, -122.1341, 'city_centroid'),
  ('Crescent City', 'Del Norte', 'Crescent City', 41.7558, -124.2026, 'city_centroid'),
  ('Oroville', 'Butte', 'Oroville', 39.5138, -121.5564, 'city_centroid'),
  ('Marysville', 'Yuba', 'Marysville', 39.1457, -121.5914, 'city_centroid'),
  ('Red Bluff', 'Tehama', 'Red Bluff', 40.1785, -122.2358, 'city_centroid'),
  ('Woodland', 'Yolo', 'Woodland', 38.6786, -121.7733, 'city_centroid'),
  ('Auburn', 'Placer', 'Auburn', 38.8966, -121.0769, 'city_centroid'),
  ('Placerville', 'El Dorado', 'Placerville', 38.7296, -120.7985, 'city_centroid'),
  ('Jackson', 'Amador', 'Jackson', 38.3488, -120.7741, 'city_centroid'),
  ('Sonora', 'Tuolumne', 'Sonora', 37.9841, -120.3821, 'city_centroid'),
  ('Mariposa', 'Mariposa', 'Mariposa', 37.4849, -119.9663, 'city_centroid'),
  ('Hanford', 'Kings', 'Hanford', 36.3275, -119.6457, 'city_centroid'),
  ('El Centro', 'Imperial', 'El Centro', 32.7920, -115.5631, 'city_centroid'),
  ('Bishop', 'Inyo', 'Bishop', 37.3635, -118.3951, 'city_centroid'),
  ('South Lake Tahoe', 'El Dorado', 'South Lake Tahoe', 38.9399, -119.9772, 'city_centroid'),
  ('Nevada City', 'Nevada', 'Nevada City', 39.2616, -121.0161, 'city_centroid'),
  ('Yreka', 'Siskiyou', 'Yreka', 41.7354, -122.6345, 'city_centroid'),
  ('Susanville', 'Lassen', 'Susanville', 40.4163, -120.6530, 'city_centroid'),
  ('Alturas', 'Modoc', 'Alturas', 41.4871, -120.5425, 'city_centroid'),
  ('Colusa', 'Colusa', 'Colusa', 39.2143, -122.0094, 'city_centroid'),
  ('Willows', 'Glenn', 'Willows', 39.5243, -122.1936, 'city_centroid'),
  ('Lakeport', 'Lake', 'Lakeport', 39.0430, -122.9158, 'city_centroid'),
  ('Quincy', 'Plumas', 'Quincy', 39.9371, -120.9472, 'city_centroid'),
  ('Downieville', 'Sierra', 'Downieville', 39.5593, -120.8274, 'city_centroid'),
  ('San Andreas', 'Calaveras', 'San Andreas', 38.1960, -120.6805, 'city_centroid'),
  ('Bridgeport', 'Mono', 'Bridgeport', 38.2557, -119.2313, 'city_centroid'),
  ('Markleeville', 'Alpine', 'Markleeville', 38.6950, -119.7807, 'city_centroid'),
  ('Independence', 'Inyo', 'Independence', 36.8028, -118.2001, 'city_centroid'),
  ('Weaverville', 'Trinity', 'Weaverville', 40.7307, -122.9416, 'city_centroid')
on conflict do nothing;

insert into public.place_centroids (postal_code, county, label, lat, lng, source)
values
  ('94102', 'San Francisco', 'San Francisco 94102', 37.7793, -122.4192, 'zip_centroid'),
  ('94103', 'San Francisco', 'San Francisco 94103', 37.7725, -122.4110, 'zip_centroid'),
  ('94612', 'Alameda', 'Oakland 94612', 37.8094, -122.2716, 'zip_centroid'),
  ('94607', 'Alameda', 'Oakland 94607', 37.8065, -122.2968, 'zip_centroid'),
  ('94704', 'Alameda', 'Berkeley 94704', 37.8688, -122.2590, 'zip_centroid'),
  ('94501', 'Alameda', 'Alameda 94501', 37.7652, -122.2416, 'zip_centroid'),
  ('94401', 'San Mateo', 'San Mateo 94401', 37.5630, -122.3255, 'zip_centroid'),
  ('94301', 'Santa Clara', 'Palo Alto 94301', 37.4443, -122.1598, 'zip_centroid'),
  ('95113', 'Santa Clara', 'San Jose 95113', 37.3337, -121.8906, 'zip_centroid'),
  ('90012', 'Los Angeles', 'Los Angeles 90012', 34.0614, -118.2380, 'zip_centroid'),
  ('90015', 'Los Angeles', 'Los Angeles 90015', 34.0392, -118.2664, 'zip_centroid'),
  ('90802', 'Los Angeles', 'Long Beach 90802', 33.7669, -118.1892, 'zip_centroid'),
  ('91101', 'Los Angeles', 'Pasadena 91101', 34.1478, -118.1445, 'zip_centroid'),
  ('90401', 'Los Angeles', 'Santa Monica 90401', 34.0195, -118.4912, 'zip_centroid'),
  ('92101', 'San Diego', 'San Diego 92101', 32.7196, -117.1625, 'zip_centroid'),
  ('95814', 'Sacramento', 'Sacramento 95814', 38.5781, -121.4944, 'zip_centroid'),
  ('93721', 'Fresno', 'Fresno 93721', 36.7378, -119.7871, 'zip_centroid'),
  ('93301', 'Kern', 'Bakersfield 93301', 35.3733, -119.0187, 'zip_centroid'),
  ('92801', 'Orange', 'Anaheim 92801', 33.8353, -117.9145, 'zip_centroid'),
  ('92501', 'Riverside', 'Riverside 92501', 33.9825, -117.3742, 'zip_centroid'),
  ('92401', 'San Bernardino', 'San Bernardino 92401', 34.1083, -117.2898, 'zip_centroid'),
  ('93101', 'Santa Barbara', 'Santa Barbara 93101', 34.4208, -119.6982, 'zip_centroid'),
  ('93401', 'San Luis Obispo', 'San Luis Obispo 93401', 35.2828, -120.6596, 'zip_centroid'),
  ('93940', 'Monterey', 'Monterey 93940', 36.6002, -121.8947, 'zip_centroid'),
  ('95401', 'Sonoma', 'Santa Rosa 95401', 38.4404, -122.7141, 'zip_centroid'),
  ('93001', 'Ventura', 'Ventura 93001', 34.2805, -119.2945, 'zip_centroid'),
  ('95616', 'Yolo', 'Davis 95616', 38.5449, -121.7405, 'zip_centroid'),
  ('92201', 'Riverside', 'Indio 92201', 33.7206, -116.2156, 'zip_centroid')
on conflict do nothing;

do $$
begin
  if not exists (
    select 1 from public.place_centroids
    where lower(city) = 'oakland' and postal_code is null
  ) then
    raise exception 'Oakland centroid missing';
  end if;
  if has_column_privilege('anon', 'public.jobs', 'site_address_private', 'select')
     or has_column_privilege('authenticated', 'public.jobs', 'site_address_private', 'select')
     or has_column_privilege('anon', 'public.jobs', 'site_lat', 'select')
     or has_column_privilege('authenticated', 'public.jobs', 'site_lat', 'select')
     or has_column_privilege('anon', 'public.jobs', 'site_lng', 'select')
     or has_column_privilege('authenticated', 'public.jobs', 'site_lng', 'select')
  then
    raise exception 'private job columns are still selectable';
  end if;
  if not has_column_privilege('anon', 'public.jobs', 'approx_lat', 'select')
     or not has_column_privilege('authenticated', 'public.jobs', 'title', 'select')
  then
    raise exception 'public job columns are not readable';
  end if;
end $$;
