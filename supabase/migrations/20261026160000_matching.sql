-- =====================================================================
-- Phase 6 — deterministic matching, then optional Grok ranking.
-- Additive. No tables or columns are dropped. RLS stays forced.
--
-- Eligibility is decided here, not by the model. A pair is suggested
-- only when every hard check passes:
--   * worker account is active
--   * job is published, not past its end or deadline, and not filled
--   * verified, unexpired CA guard registration on the shift date
--   * armed posts also need a verified, unexpired exposed firearm permit
--   * executive protection and close protection need verified ep_training
--   * requires_off_duty_le needs le_officer_profiles.status
--     approval_documented, unexpired on the shift date
--   * armed posts need a verified PPO, PPO branch, or proprietary
--     private security employer. Unarmed posts need a verified
--     organization of any type. This is a product filter, not a
--     legal determination.
--   * every mandatory job_requirements credential is verified and
--     unexpired on the shift date
--   * distance from the worker's approximate point (profile coords, or
--     place_centroids for city/ZIP) to jobs.approx_lat/lng is within
--     work_radius_miles
--   * availability covers the shift, or the post has no fixed window
--     and the worker has declared some availability
--   * no block in either direction with a current organization member
--   * no application row yet
--   * hourly pay is not below the worker's minimum, when they set one
--   * employer suggestions additionally require is_searchable
--
-- Grok is not called from SQL. The server may rank this set. It cannot
-- add ids. Explanations are built from reason codes in this file.
--
-- Fields the application is allowed to send to Grok (no others):
--   id, distance_miles, radius_miles, years_experience,
--   min_years_experience, category_match, pay_type, pay_min_cents,
--   pay_meets_minimum, urgency, shift_period, is_armed,
--   vehicle_required, has_transportation, availability_kind,
--   guard_card_active, firearm_permit_active, ep_training_active,
--   off_duty_le_approved, ppo_requirement_met, mandatory_credentials_met
-- Names, free text, languages, credentials numbers, documents, precise
-- coordinates, postal codes, contact details, law-enforcement narratives,
-- and any protected-class or conviction field are not in that list.
-- There is no conviction-history column.
-- =====================================================================

alter table public.jobs
  add column if not exists requires_off_duty_le boolean not null default false;

comment on column public.jobs.requires_off_duty_le is
  'When true, suggestions require a human-recorded off-duty approval (approval_documented) that has not expired. Not a determination that the officer may work.';

grant select (requires_off_duty_le) on table public.jobs to anon, authenticated;
grant insert (requires_off_duty_le) on table public.jobs to authenticated;
grant update (requires_off_duty_le) on table public.jobs to authenticated;

-- ---------------------------------------------------------------------
-- Credential, availability, and pair facts
-- ---------------------------------------------------------------------
create or replace function app.holds_verified_credential(
  p_worker uuid,
  p_code text,
  p_day date
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.credentials c
    join public.credential_types t on t.id = c.credential_type_id
    where c.worker_id = p_worker
      and t.code = p_code
      and c.status = 'verified'
      and (c.expires_on is null or c.expires_on >= p_day)
  )
$$;

create or replace function app.shift_available(
  p_worker uuid,
  p_starts timestamptz,
  p_ends timestamptz
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamp;
  v_end timestamp;
  v_anchor date;
  v_win_start timestamp;
  v_win_end timestamp;
  r record;
  v_covered boolean := false;
begin
  if not exists (
    select 1 from public.worker_availability a
    where a.worker_id = p_worker and a.is_available
  ) then
    return false;
  end if;

  -- No fixed window: declared availability is the whole check.
  if p_starts is null or p_ends is null then
    return true;
  end if;

  if exists (
    select 1 from public.worker_availability a
    where a.worker_id = p_worker
      and not a.is_available
      and a.starts_at is not null
      and a.starts_at < p_ends
      and a.ends_at > p_starts
  ) then
    return false;
  end if;

  v_start := p_starts at time zone 'America/Los_Angeles';
  v_end := p_ends at time zone 'America/Los_Angeles';

  for r in
    select a.weekday, a.start_time, a.end_time, a.is_available
    from public.worker_availability a
    where a.worker_id = p_worker and a.weekday is not null
  loop
    for v_anchor in
      select d::date from (values (v_start::date), (v_start::date - 1)) as t(d)
    loop
      if extract(dow from v_anchor)::integer is distinct from r.weekday::integer then
        continue;
      end if;
      v_win_start := v_anchor + r.start_time;
      if r.end_time > r.start_time then
        v_win_end := v_anchor + r.end_time;
      else
        -- end <= start is an overnight window. Equal times cover 24 hours.
        v_win_end := (v_anchor + 1) + r.end_time;
      end if;
      if not r.is_available and v_win_start < v_end and v_win_end > v_start then
        return false;
      end if;
      if r.is_available and v_win_start <= v_start and v_win_end >= v_end then
        v_covered := true;
      end if;
    end loop;
  end loop;

  if v_covered then
    return true;
  end if;

  return exists (
    select 1 from public.worker_availability a
    where a.worker_id = p_worker
      and a.is_available
      and a.starts_at is not null
      and a.starts_at <= p_starts
      and a.ends_at >= p_ends
  );
end
$$;

create or replace function app.match_fact(
  p_worker uuid,
  p_job uuid,
  p_require_searchable boolean
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_worker public.worker_profiles%rowtype;
  v_status public.account_status;
  v_name text;
  v_job public.jobs%rowtype;
  v_org_type public.org_type;
  v_org_status public.verification_status;
  v_org_name text;
  v_day date;
  v_lat numeric;
  v_lng numeric;
  v_miles numeric;
  v_held text[];
  v_guard boolean;
  v_firearm boolean;
  v_ep boolean;
  v_le boolean;
  v_requires_ep boolean;
  v_ppo boolean;
  v_available boolean;
  v_pay_below boolean;
  v_pay_meets boolean;
begin
  select * into v_worker from public.worker_profiles where user_id = p_worker;
  if not found then
    return null;
  end if;
  select p.status, p.display_name into v_status, v_name
  from public.profiles p where p.id = p_worker;
  if v_status is distinct from 'active' then
    return null;
  end if;
  if p_require_searchable and not v_worker.is_searchable then
    return null;
  end if;

  select * into v_job from public.jobs where id = p_job;
  if not found or v_job.status is distinct from 'published' then
    return null;
  end if;
  if v_job.application_deadline is not null and v_job.application_deadline <= pg_catalog.now() then
    return null;
  end if;
  if v_job.ends_at is not null and v_job.ends_at <= pg_catalog.now() then
    return null;
  end if;
  if app.active_assignment_count(p_job) >= v_job.workers_needed then
    return null;
  end if;
  if exists (
    select 1 from public.applications a
    where a.job_id = p_job and a.worker_id = p_worker
  ) then
    return null;
  end if;
  if exists (
    select 1
    from public.organization_members m
    join public.user_blocks b
      on (b.blocker_id = p_worker and b.blocked_id = m.user_id)
      or (b.blocker_id = m.user_id and b.blocked_id = p_worker)
    where m.organization_id = v_job.organization_id
  ) then
    return null;
  end if;

  select o.org_type, o.verification_status, o.name
    into v_org_type, v_org_status, v_org_name
  from public.organizations o
  where o.id = v_job.organization_id;
  if v_org_status is distinct from 'verified' then
    return null;
  end if;
  v_ppo := (not v_job.is_armed) or v_org_type in (
    'ppo', 'private_patrol_operator_branch', 'proprietary_security_employer'
  );
  if not v_ppo then
    return null;
  end if;

  v_day := coalesce((v_job.starts_at at time zone 'America/Los_Angeles')::date, app.pacific_today());
  select coalesce(array_agg(t.code), '{}'::text[]) into v_held
  from public.credentials c
  join public.credential_types t on t.id = c.credential_type_id
  where c.worker_id = p_worker
    and c.status = 'verified'
    and (c.expires_on is null or c.expires_on >= v_day);

  v_guard := 'ca_guard_registration' = any (v_held);
  v_firearm := 'ca_exposed_firearm_permit' = any (v_held);
  v_ep := 'ep_training' = any (v_held);
  v_requires_ep := v_job.category in ('executive_protection', 'close_protection');
  if not v_guard or (v_job.is_armed and not v_firearm) or (v_requires_ep and not v_ep) then
    return null;
  end if;
  if exists (
    select 1
    from public.job_requirements jr
    join public.credential_types t on t.id = jr.credential_type_id
    where jr.job_id = p_job
      and jr.is_mandatory
      and not (t.code = any (v_held))
  ) then
    return null;
  end if;

  v_le := exists (
    select 1 from public.le_officer_profiles le
    where le.worker_id = p_worker
      and le.status = 'approval_documented'
      and (le.secondary_approval_expires_on is null or le.secondary_approval_expires_on >= v_day)
  );
  if v_job.requires_off_duty_le and not v_le then
    return null;
  end if;

  if v_worker.work_radius_miles is null or v_job.approx_lat is null or v_job.approx_lng is null then
    return null;
  end if;
  if v_worker.approx_lat is not null and v_worker.approx_lng is not null then
    v_lat := v_worker.approx_lat;
    v_lng := v_worker.approx_lng;
  else
    select c.lat, c.lng into v_lat, v_lng
    from app.lookup_centroid(v_worker.city, v_worker.county, v_worker.postal_code) c;
  end if;
  if v_lat is null or v_lng is null then
    return null;
  end if;
  v_miles := app.miles_between(v_lat, v_lng, v_job.approx_lat, v_job.approx_lng);
  if v_miles > v_worker.work_radius_miles then
    return null;
  end if;

  v_available := app.shift_available(p_worker, v_job.starts_at, v_job.ends_at);
  if not v_available then
    return null;
  end if;

  v_pay_below := v_worker.min_hourly_rate_cents is not null
    and v_job.pay_type = 'hourly'
    and (v_job.pay_min_cents is null or v_job.pay_min_cents < v_worker.min_hourly_rate_cents);
  if v_pay_below then
    return null;
  end if;
  v_pay_meets := v_job.pay_type = 'hourly';

  return jsonb_build_object(
    'job_id', v_job.id,
    'worker_id', p_worker,
    'title', v_job.title,
    'category', v_job.category,
    'is_armed', v_job.is_armed,
    'job_city', v_job.city,
    'job_county', v_job.county,
    'shift_period', v_job.shift_period,
    'starts_at', v_job.starts_at,
    'ends_at', v_job.ends_at,
    'pay_type', v_job.pay_type,
    'pay_min_cents', v_job.pay_min_cents,
    'pay_max_cents', v_job.pay_max_cents,
    'urgency', v_job.urgency,
    'organization_name', v_org_name,
    'distance_miles', v_miles,
    'radius_miles', v_worker.work_radius_miles,
    'years_experience', v_worker.years_experience,
    'min_years_experience', v_job.min_years_experience,
    'has_transportation', v_worker.has_transportation,
    'vehicle_required', v_job.vehicle_required,
    'category_match', v_job.category = any (v_worker.preferred_categories),
    'pay_meets_minimum', v_pay_meets,
    'availability_kind', case
      when v_job.starts_at is null or v_job.ends_at is null then 'open_schedule'
      else 'covers_shift'
    end,
    'guard_card_active', v_guard,
    'firearm_permit_active', v_firearm,
    'ep_training_active', v_ep,
    'off_duty_le_approved', v_le,
    'requires_off_duty_le', v_job.requires_off_duty_le,
    'requires_ep', v_requires_ep,
    'ppo_ok', v_ppo,
    'org_verified', true,
    'mandatory_credentials_met', true,
    'display_name', v_name,
    'headline', v_worker.headline,
    'worker_city', v_worker.city,
    'worker_county', v_worker.county,
    'credentials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', t.code,
        'name', t.name,
        'expires_on', c.expires_on
      ) order by t.code)
      from public.credentials c
      join public.credential_types t on t.id = c.credential_type_id
      where c.worker_id = p_worker
        and c.status = 'verified'
        and (c.expires_on is null or c.expires_on >= v_day)
        and t.code = any (v_held)
    ), '[]'::jsonb)
  );
end
$$;

create or replace function app.match_score(p_fact jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_score numeric := 0;
  v_years numeric;
  v_min numeric;
  v_distance numeric;
  v_radius numeric;
begin
  if p_fact is null then
    return 0;
  end if;
  if coalesce((p_fact->>'category_match')::boolean, false) then
    v_score := v_score + 30;
  end if;
  v_distance := (p_fact->>'distance_miles')::numeric;
  v_radius := greatest(coalesce((p_fact->>'radius_miles')::numeric, 1), 1);
  if v_distance is not null then
    v_score := v_score + greatest(0, round(25 * (1 - v_distance / v_radius)));
  end if;
  if coalesce((p_fact->>'pay_meets_minimum')::boolean, false) then
    v_score := v_score + 15;
  end if;
  v_years := (p_fact->>'years_experience')::numeric;
  v_min := (p_fact->>'min_years_experience')::numeric;
  if v_years is not null and v_min is not null then
    v_score := v_score + least(10, greatest(0, v_years - v_min));
  elsif v_years is not null then
    v_score := v_score + least(10, v_years);
  end if;
  if p_fact->>'urgency' = 'urgent' then
    v_score := v_score + 10;
  elsif p_fact->>'urgency' = 'priority' then
    v_score := v_score + 5;
  end if;
  if coalesce((p_fact->>'vehicle_required')::boolean, false)
     and coalesce((p_fact->>'has_transportation')::boolean, false) then
    v_score := v_score + 10;
  end if;
  return v_score;
end
$$;

create or replace function app.match_supported_codes(p_fact jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_codes text[] := array[
    'GUARD_CARD_ACTIVE',
    'ORG_VERIFIED',
    'AVAILABLE',
    'WITHIN_RADIUS',
    'NOT_BLOCKED',
    'NOT_APPLIED',
    'MANDATORY_CREDENTIALS'
  ];
begin
  if coalesce((p_fact->>'is_armed')::boolean, false)
     and coalesce((p_fact->>'firearm_permit_active')::boolean, false) then
    v_codes := array_append(v_codes, 'FIREARM_PERMIT_ACTIVE');
  end if;
  if coalesce((p_fact->>'requires_ep')::boolean, false)
     and coalesce((p_fact->>'ep_training_active')::boolean, false) then
    v_codes := array_append(v_codes, 'EP_TRAINING_ACTIVE');
  end if;
  if coalesce((p_fact->>'requires_off_duty_le')::boolean, false)
     and coalesce((p_fact->>'off_duty_le_approved')::boolean, false) then
    v_codes := array_append(v_codes, 'OFF_DUTY_LE_APPROVED');
  end if;
  if coalesce((p_fact->>'is_armed')::boolean, false)
     and coalesce((p_fact->>'ppo_ok')::boolean, false) then
    v_codes := array_append(v_codes, 'PPO_VERIFIED');
  end if;
  if coalesce((p_fact->>'category_match')::boolean, false) then
    v_codes := array_append(v_codes, 'CATEGORY_MATCH');
  end if;
  if p_fact->>'years_experience' is not null then
    v_codes := array_append(v_codes, 'EXPERIENCE_YEARS');
  end if;
  if coalesce((p_fact->>'pay_meets_minimum')::boolean, false) then
    v_codes := array_append(v_codes, 'PAY_MEETS_MINIMUM');
  end if;
  if coalesce((p_fact->>'vehicle_required')::boolean, false)
     and coalesce((p_fact->>'has_transportation')::boolean, false) then
    v_codes := array_append(v_codes, 'TRANSPORTATION');
  end if;
  if p_fact->>'urgency' in ('urgent', 'priority') then
    v_codes := array_append(v_codes, 'URGENCY');
  end if;
  return v_codes;
end
$$;

create or replace function app.match_explanation(p_fact jsonb, p_codes text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}'::text[];
  v_expires text;
  v_text text;
begin
  if 'WITHIN_RADIUS' = any (p_codes) then
    v_parts := array_append(v_parts, format(
      'About %s miles away, inside a %s-mile radius.',
      trim(to_char((p_fact->>'distance_miles')::numeric, 'FM999990.0')),
      p_fact->>'radius_miles'
    ));
  end if;
  if 'GUARD_CARD_ACTIVE' = any (p_codes) then
    select c->>'expires_on' into v_expires
    from jsonb_array_elements(coalesce(p_fact->'credentials', '[]'::jsonb)) c
    where c->>'code' = 'ca_guard_registration'
    limit 1;
    if v_expires is null then
      v_parts := array_append(v_parts, 'Guard card is verified and does not have an expiry on file.');
    else
      v_parts := array_append(v_parts, format('Guard card is verified through %s.', v_expires));
    end if;
  end if;
  if 'FIREARM_PERMIT_ACTIVE' = any (p_codes) then
    v_parts := array_append(v_parts, 'Exposed firearm permit is verified and unexpired on the shift date.');
  end if;
  if 'EP_TRAINING_ACTIVE' = any (p_codes) then
    v_parts := array_append(v_parts, 'Executive protection training is verified and unexpired on the shift date.');
  end if;
  if 'OFF_DUTY_LE_APPROVED' = any (p_codes) then
    v_parts := array_append(v_parts, 'Off-duty approval is recorded and unexpired on the shift date.');
  end if;
  if 'PPO_VERIFIED' = any (p_codes) then
    v_parts := array_append(v_parts, 'The hiring organization is a verified PPO, PPO branch, or proprietary security employer.');
  end if;
  if 'ORG_VERIFIED' = any (p_codes) and not ('PPO_VERIFIED' = any (p_codes)) then
    v_parts := array_append(v_parts, 'The hiring organization is verified.');
  end if;
  if 'AVAILABLE' = any (p_codes) then
    if p_fact->>'availability_kind' = 'open_schedule' then
      v_parts := array_append(v_parts, 'Availability is on file. This post has no fixed shift window.');
    else
      v_parts := array_append(v_parts, 'Available for this shift.');
    end if;
  end if;
  if 'MANDATORY_CREDENTIALS' = any (p_codes) then
    v_parts := array_append(v_parts, 'Required credentials are verified and unexpired on the shift date.');
  end if;
  if 'CATEGORY_MATCH' = any (p_codes) then
    v_parts := array_append(v_parts, 'The security category is one this worker listed.');
  end if;
  if 'PAY_MEETS_MINIMUM' = any (p_codes) then
    v_parts := array_append(v_parts, 'Hourly pay meets the worker minimum on file.');
  end if;
  if 'EXPERIENCE_YEARS' = any (p_codes) and p_fact->>'years_experience' is not null then
    v_parts := array_append(v_parts, format('%s years of experience are on the profile.', p_fact->>'years_experience'));
  end if;
  if 'TRANSPORTATION' = any (p_codes) then
    v_parts := array_append(v_parts, 'Transportation is on file for a post that asks for a vehicle.');
  end if;
  if 'URGENCY' = any (p_codes) then
    v_parts := array_append(v_parts, 'The post is marked priority or urgent by the employer.');
  end if;
  if 'NOT_BLOCKED' = any (p_codes) then
    v_parts := array_append(v_parts, 'No block is on file between the worker and this organization.');
  end if;
  if 'NOT_APPLIED' = any (p_codes) then
    v_parts := array_append(v_parts, 'No application exists for this shift yet.');
  end if;
  v_text := array_to_string(v_parts, ' ');
  if v_text = '' then
    v_text := 'Passed the eligibility checks.';
  end if;
  return left(v_text, 500);
end
$$;

create or replace function app.match_checklist(p_fact jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('code', 'GUARD_CARD_ACTIVE', 'passed', true, 'applicable', true,
      'label', 'Verified guard card, unexpired on the shift date'),
    jsonb_build_object('code', 'FIREARM_PERMIT_ACTIVE', 'passed', true, 'applicable', coalesce((p_fact->>'is_armed')::boolean, false),
      'label', case when coalesce((p_fact->>'is_armed')::boolean, false)
        then 'Verified exposed firearm permit, unexpired on the shift date'
        else 'Firearm permit is not required for this post' end),
    jsonb_build_object('code', 'EP_TRAINING_ACTIVE', 'passed', true, 'applicable', coalesce((p_fact->>'requires_ep')::boolean, false),
      'label', case when coalesce((p_fact->>'requires_ep')::boolean, false)
        then 'Verified executive protection training, unexpired on the shift date'
        else 'Executive protection training is not required for this post' end),
    jsonb_build_object('code', 'OFF_DUTY_LE_APPROVED', 'passed', true, 'applicable', coalesce((p_fact->>'requires_off_duty_le')::boolean, false),
      'label', case when coalesce((p_fact->>'requires_off_duty_le')::boolean, false)
        then 'Recorded off-duty approval, unexpired on the shift date'
        else 'Off-duty law-enforcement approval is not required for this post' end),
    jsonb_build_object('code', 'PPO_VERIFIED', 'passed', true, 'applicable', coalesce((p_fact->>'is_armed')::boolean, false),
      'label', case when coalesce((p_fact->>'is_armed')::boolean, false)
        then 'Hiring organization is a verified PPO, PPO branch, or proprietary security employer'
        else 'Armed-post licensing filter does not apply' end),
    jsonb_build_object('code', 'ORG_VERIFIED', 'passed', true, 'applicable', true,
      'label', 'Hiring organization is verified'),
    jsonb_build_object('code', 'WITHIN_RADIUS', 'passed', true, 'applicable', true,
      'label', format('Within the %s-mile work radius (about %s miles)',
        p_fact->>'radius_miles',
        trim(to_char((p_fact->>'distance_miles')::numeric, 'FM999990.0')))),
    jsonb_build_object('code', 'AVAILABLE', 'passed', true, 'applicable', true,
      'label', case when p_fact->>'availability_kind' = 'open_schedule'
        then 'Availability is on file for a post without a fixed window'
        else 'Available for this shift' end),
    jsonb_build_object('code', 'NOT_BLOCKED', 'passed', true, 'applicable', true,
      'label', 'Not blocked'),
    jsonb_build_object('code', 'NOT_APPLIED', 'passed', true, 'applicable', true,
      'label', 'Has not applied'),
    jsonb_build_object('code', 'MANDATORY_CREDENTIALS', 'passed', true, 'applicable', true,
      'label', 'Mandatory credentials on the post are verified and unexpired'),
    jsonb_build_object('code', 'PAY_MEETS_MINIMUM', 'passed', true, 'applicable', coalesce((p_fact->>'pay_meets_minimum')::boolean, false),
      'label', case when coalesce((p_fact->>'pay_meets_minimum')::boolean, false)
        then 'Hourly pay meets the worker minimum'
        else 'Hourly minimum does not apply to this pay type' end)
  )
$$;

create or replace function app.eligible_shift_facts(p_worker uuid)
returns table (fact jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select f.fact
  from (
    select app.match_fact(p_worker, j.id, false) as fact
    from public.jobs j
    where j.status = 'published'
  ) f
  where f.fact is not null
  order by (f.fact->>'distance_miles')::numeric, (f.fact->>'job_id')
  limit 200
$$;

create or replace function app.eligible_worker_facts(p_job uuid)
returns table (fact jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select f.fact
  from (
    select app.match_fact(w.user_id, p_job, true) as fact
    from public.worker_profiles w
    where w.is_searchable
  ) f
  where f.fact is not null
  order by (f.fact->>'distance_miles')::numeric, (f.fact->>'worker_id')
  limit 200
$$;

create or replace function public.eligible_shifts_for_me()
returns table (job_id uuid, fact jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.account_status;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select status into v_status from public.profiles where id = v_uid;
  if v_status in ('suspended', 'deactivated') then
    raise exception 'account not active' using errcode = '42501';
  end if;
  if not exists (select 1 from public.worker_profiles w where w.user_id = v_uid) then
    return;
  end if;
  return query
  select (f.fact->>'job_id')::uuid, f.fact
  from app.eligible_shift_facts(v_uid) f;
end
$$;

create or replace function public.eligible_workers_for_job(p_job_id uuid)
returns table (worker_id uuid, fact jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.account_status;
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select status into v_status from public.profiles where id = v_uid;
  if v_status in ('suspended', 'deactivated') then
    raise exception 'account not active' using errcode = '42501';
  end if;
  select organization_id into v_org from public.jobs where id = p_job_id;
  if v_org is null or not app.is_org_member(v_org) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  return query
  select (f.fact->>'worker_id')::uuid, f.fact
  from app.eligible_worker_facts(p_job_id) f;
end
$$;

-- ---------------------------------------------------------------------
-- Stored suggestions. Clients cannot insert them.
-- ---------------------------------------------------------------------
create table public.match_runs (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  direction text not null,
  job_id uuid references public.jobs(id) on delete cascade,
  worker_id uuid references public.worker_profiles(user_id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  model text not null,
  model_version text not null,
  source text not null,
  fallback_reason text,
  eligible_count integer not null,
  ranked_count integer not null,
  prompt_fields text[] not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint match_runs_direction check (direction in ('jobs_for_worker', 'workers_for_job')),
  constraint match_runs_shape check (
    (direction = 'jobs_for_worker' and worker_id is not null and job_id is null)
    or (direction = 'workers_for_job' and job_id is not null and worker_id is null)
  ),
  constraint match_runs_source check (source in ('grok', 'deterministic_fallback')),
  constraint match_runs_fallback check (
    fallback_reason is null
    or fallback_reason in ('missing_api_key', 'provider_error', 'invalid_output', 'empty_eligible_set')
  ),
  constraint match_runs_fallback_pair check (
    (source = 'grok' and fallback_reason is null)
    or (source = 'deterministic_fallback' and fallback_reason is not null)
  ),
  constraint match_runs_model check (
    model ~ '^[A-Za-z0-9_.:-]{1,80}$' and model_version ~ '^[A-Za-z0-9_.:-]{1,80}$'
  ),
  constraint match_runs_counts check (
    eligible_count >= 0 and ranked_count >= 0 and ranked_count <= 40 and ranked_count <= eligible_count
  )
);

comment on table public.match_runs is
  'One suggestion refresh. model and model_version record Grok or the deterministic ranker. prompt_fields is the allowlist sent to Grok, not the payload.';

create table public.match_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.match_runs(id) on delete cascade,
  rank integer not null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  worker_id uuid not null references public.worker_profiles(user_id) on delete cascade,
  score numeric not null,
  reason_codes text[] not null,
  explanation text not null,
  checklist jsonb not null,
  subject_label text not null,
  meta_line text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  constraint match_suggestions_rank check (rank between 1 and 40),
  constraint match_suggestions_explanation check (char_length(explanation) between 1 and 500),
  constraint match_suggestions_label check (char_length(subject_label) between 1 and 140),
  constraint match_suggestions_meta check (char_length(meta_line) <= 240),
  unique (run_id, rank),
  unique (run_id, job_id, worker_id)
);

comment on table public.match_suggestions is
  'Ranked pairs from a match run. Explanations are server-built from reason codes. Not an offer, rejection, or application.';

create index match_runs_requester_created_idx on public.match_runs (requester_id, created_at desc);
create index match_runs_worker_id_idx on public.match_runs (worker_id);
create index match_runs_job_id_idx on public.match_runs (job_id);
create index match_runs_organization_id_idx on public.match_runs (organization_id, created_at desc);
create index match_suggestions_run_idx on public.match_suggestions (run_id, rank);
create index match_suggestions_job_id_idx on public.match_suggestions (job_id);
create index match_suggestions_worker_id_idx on public.match_suggestions (worker_id);

alter table public.match_runs enable row level security;
alter table public.match_runs force row level security;
alter table public.match_suggestions enable row level security;
alter table public.match_suggestions force row level security;

create policy match_runs_select on public.match_runs
  for select to authenticated
  using (
    requester_id = (select auth.uid())
    or worker_id = (select auth.uid())
    or (organization_id is not null and app.is_org_member(organization_id))
    or app.is_staff()
  );

create policy match_suggestions_select on public.match_suggestions
  for select to authenticated
  using (
    exists (
      select 1 from public.match_runs r
      where r.id = run_id
        and (
          r.requester_id = (select auth.uid())
          or r.worker_id = (select auth.uid())
          or (r.organization_id is not null and app.is_org_member(r.organization_id))
          or app.is_staff()
        )
    )
  );

revoke all on table public.match_runs from public, anon, authenticated;
revoke all on table public.match_suggestions from public, anon, authenticated;
grant select (
  id, requester_id, direction, job_id, worker_id, organization_id,
  model, model_version, source, fallback_reason, eligible_count, ranked_count,
  prompt_fields, created_at
) on table public.match_runs to authenticated;
grant select (
  id, run_id, rank, job_id, worker_id, score, reason_codes, explanation,
  checklist, subject_label, meta_line, created_at
) on table public.match_suggestions to authenticated;

create or replace function public.record_match_run(
  p_actor uuid,
  p_direction text,
  p_job_id uuid,
  p_ordered_ids uuid[],
  p_reason_codes jsonb,
  p_model text,
  p_model_version text,
  p_source text,
  p_fallback_reason text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_user_agent text,
  p_request_id text,
  p_ip text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
  v_status public.account_status;
  v_org uuid;
  v_map jsonb := '{}'::jsonb;
  v_fact jsonb;
  v_id uuid;
  v_key text;
  v_seen uuid[] := '{}'::uuid[];
  v_rank integer := 0;
  v_run uuid;
  v_eligible integer := 0;
  v_dropped integer := 0;
  v_supported text[];
  v_requested text[];
  v_codes text[];
  v_fields text[] := array[
    'id', 'distance_miles', 'radius_miles', 'years_experience', 'min_years_experience',
    'category_match', 'pay_type', 'pay_min_cents', 'pay_meets_minimum', 'urgency',
    'shift_period', 'is_armed', 'vehicle_required', 'has_transportation', 'availability_kind',
    'guard_card_active', 'firearm_permit_active', 'ep_training_active', 'off_duty_le_approved',
    'ppo_requirement_met', 'mandatory_credentials_met'
  ];
  v_hour integer;
  v_day integer;
  v_label text;
  v_meta text;
begin
  if v_role is not null and v_role <> 'service_role' then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_direction not in ('jobs_for_worker', 'workers_for_job') then
    raise exception 'invalid direction' using errcode = '22023';
  end if;
  if p_source not in ('grok', 'deterministic_fallback') then
    raise exception 'invalid match source' using errcode = '22023';
  end if;
  if p_source = 'deterministic_fallback' and (p_model is distinct from 'deterministic' or p_model_version is distinct from 'v1') then
    raise exception 'invalid model' using errcode = '22023';
  end if;
  if p_source = 'grok' and (p_model is not distinct from 'deterministic' or p_fallback_reason is not null) then
    raise exception 'invalid model' using errcode = '22023';
  end if;
  if p_model !~ '^[A-Za-z0-9_.:-]{1,80}$' or p_model_version !~ '^[A-Za-z0-9_.:-]{1,80}$' then
    raise exception 'invalid model' using errcode = '22023';
  end if;
  if p_fallback_reason is not null and p_fallback_reason not in (
    'missing_api_key', 'provider_error', 'invalid_output', 'empty_eligible_set'
  ) then
    raise exception 'invalid fallback' using errcode = '22023';
  end if;
  if p_source = 'deterministic_fallback' and p_fallback_reason is null then
    raise exception 'invalid fallback' using errcode = '22023';
  end if;
  if p_input_tokens is not null and p_input_tokens < 0 then
    raise exception 'invalid tokens' using errcode = '22023';
  end if;
  if p_output_tokens is not null and p_output_tokens < 0 then
    raise exception 'invalid tokens' using errcode = '22023';
  end if;

  select status into v_status from public.profiles where id = p_actor;
  if v_status is null or v_status in ('suspended', 'deactivated') then
    raise exception 'account not active' using errcode = '42501';
  end if;

  if p_direction = 'jobs_for_worker' then
    if p_job_id is not null then
      raise exception 'invalid direction' using errcode = '22023';
    end if;
    if not exists (select 1 from public.worker_profiles w where w.user_id = p_actor) then
      raise exception 'not a worker' using errcode = '42501';
    end if;
    for v_fact in select f.fact from app.eligible_shift_facts(p_actor) f
    loop
      v_map := v_map || jsonb_build_object(v_fact->>'job_id', v_fact);
    end loop;
  else
    if p_job_id is null then
      raise exception 'invalid direction' using errcode = '22023';
    end if;
    select j.organization_id into v_org from public.jobs j where j.id = p_job_id;
    if v_org is null or not exists (
      select 1 from public.organization_members m
      where m.organization_id = v_org and m.user_id = p_actor
    ) then
      raise exception 'not a member' using errcode = '42501';
    end if;
    for v_fact in select f.fact from app.eligible_worker_facts(p_job_id) f
    loop
      v_map := v_map || jsonb_build_object(v_fact->>'worker_id', v_fact);
    end loop;
  end if;

  select count(*)::integer into v_hour
  from public.match_runs r
  where r.requester_id = p_actor and r.created_at > pg_catalog.now() - interval '1 hour';
  select count(*)::integer into v_day
  from public.match_runs r
  where r.requester_id = p_actor and r.created_at > pg_catalog.now() - interval '24 hours';
  if v_hour >= 20 or v_day >= 80 then
    raise exception 'match rate limit' using errcode = '53400';
  end if;

  select count(*)::integer into v_eligible from jsonb_object_keys(v_map);

  insert into public.match_runs (
    requester_id, direction, job_id, worker_id, organization_id,
    model, model_version, source, fallback_reason,
    eligible_count, ranked_count, prompt_fields
  ) values (
    p_actor,
    p_direction,
    case when p_direction = 'workers_for_job' then p_job_id else null end,
    case when p_direction = 'jobs_for_worker' then p_actor else null end,
    v_org,
    p_model,
    p_model_version,
    p_source,
    p_fallback_reason,
    v_eligible,
    0,
    v_fields
  ) returning id into v_run;

  foreach v_id in array coalesce(p_ordered_ids, '{}'::uuid[])
  loop
    exit when v_rank >= 40;
    if v_id = any (v_seen) then
      continue;
    end if;
    v_fact := v_map -> v_id::text;
    if v_fact is null then
      v_dropped := v_dropped + 1;
      continue;
    end if;
    v_seen := v_seen || v_id;
    v_rank := v_rank + 1;
    v_supported := app.match_supported_codes(v_fact);
    select coalesce(array_agg(code), '{}'::text[]) into v_requested
    from jsonb_array_elements_text(coalesce(p_reason_codes -> v_id::text, '[]'::jsonb)) as t(code)
    where code = any (v_supported);
    v_codes := case when coalesce(cardinality(v_requested), 0) = 0 then v_supported else v_requested end;
    v_label := left(coalesce(nullif(case when p_direction = 'jobs_for_worker' then v_fact->>'title' else v_fact->>'display_name' end, ''), case when p_direction = 'jobs_for_worker' then 'Shift' else 'Worker' end), 140);
    v_meta := left(case
      when p_direction = 'jobs_for_worker' then concat_ws(' · ', nullif(v_fact->>'job_city', ''), nullif(v_fact->>'organization_name', ''))
      else concat_ws(' · ', nullif(v_fact->>'worker_city', ''), nullif(v_fact->>'worker_county', ''))
    end, 240);
    insert into public.match_suggestions (
      run_id, rank, job_id, worker_id, score, reason_codes, explanation, checklist, subject_label, meta_line
    ) values (
      v_run,
      v_rank,
      (v_fact->>'job_id')::uuid,
      (v_fact->>'worker_id')::uuid,
      app.match_score(v_fact),
      v_codes,
      app.match_explanation(v_fact, v_codes),
      app.match_checklist(v_fact),
      v_label,
      coalesce(v_meta, '')
    );
  end loop;

  for v_key, v_fact in
    select e.key, e.value
    from jsonb_each(v_map) e
    order by app.match_score(e.value) desc, (e.value->>'distance_miles')::numeric, e.key
  loop
    exit when v_rank >= 40;
    v_id := v_key::uuid;
    if v_id = any (v_seen) then
      continue;
    end if;
    v_seen := v_seen || v_id;
    v_rank := v_rank + 1;
    v_codes := app.match_supported_codes(v_fact);
    v_label := left(coalesce(nullif(case when p_direction = 'jobs_for_worker' then v_fact->>'title' else v_fact->>'display_name' end, ''), case when p_direction = 'jobs_for_worker' then 'Shift' else 'Worker' end), 140);
    v_meta := left(case
      when p_direction = 'jobs_for_worker' then concat_ws(' · ', nullif(v_fact->>'job_city', ''), nullif(v_fact->>'organization_name', ''))
      else concat_ws(' · ', nullif(v_fact->>'worker_city', ''), nullif(v_fact->>'worker_county', ''))
    end, 240);
    insert into public.match_suggestions (
      run_id, rank, job_id, worker_id, score, reason_codes, explanation, checklist, subject_label, meta_line
    ) values (
      v_run,
      v_rank,
      (v_fact->>'job_id')::uuid,
      (v_fact->>'worker_id')::uuid,
      app.match_score(v_fact),
      v_codes,
      app.match_explanation(v_fact, v_codes),
      app.match_checklist(v_fact),
      v_label,
      coalesce(v_meta, '')
    );
  end loop;

  update public.match_runs set ranked_count = v_rank where id = v_run;

  insert into public.audit_logs (
    actor_type, actor_id, organization_id, action, entity_type, entity_id, after_data, ip_address, user_agent, request_id
  ) values (
    case when p_source = 'grok' then 'ai_assistant'::public.actor_type else 'system'::public.actor_type end,
    p_actor,
    v_org,
    'match.run',
    'match_run',
    v_run,
    jsonb_build_object(
      'direction', p_direction,
      'model', p_model,
      'model_version', p_model_version,
      'source', p_source,
      'fallback_reason', p_fallback_reason,
      'eligible_count', v_eligible,
      'ranked_count', v_rank,
      'dropped_count', v_dropped,
      'prompt_fields', to_jsonb(v_fields),
      'job_id', p_job_id
    ),
    app.try_inet(p_ip),
    left(coalesce(p_user_agent, ''), 512),
    left(coalesce(p_request_id, ''), 128)
  );

  if p_source = 'grok' then
    insert into public.ai_tool_calls (
      user_id, tool_name, arguments, result_summary, model, input_tokens, output_tokens, required_confirmation
    ) values (
      p_actor,
      'rank_eligible_matches',
      jsonb_build_object('fields', to_jsonb(v_fields), 'eligible_count', v_eligible, 'direction', p_direction),
      jsonb_build_object('ranked_count', v_rank, 'dropped_count', v_dropped),
      p_model,
      p_input_tokens,
      p_output_tokens,
      false
    );
  end if;

  return v_run;
end
$$;

revoke all on function app.holds_verified_credential(uuid, text, date) from public, anon, authenticated;
revoke all on function app.shift_available(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function app.match_fact(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function app.match_score(jsonb) from public, anon, authenticated;
revoke all on function app.match_supported_codes(jsonb) from public, anon, authenticated;
revoke all on function app.match_explanation(jsonb, text[]) from public, anon, authenticated;
revoke all on function app.match_checklist(jsonb) from public, anon, authenticated;
revoke all on function app.eligible_shift_facts(uuid) from public, anon, authenticated;
revoke all on function app.eligible_worker_facts(uuid) from public, anon, authenticated;

revoke all on function public.eligible_shifts_for_me() from public, anon;
revoke all on function public.eligible_workers_for_job(uuid) from public, anon;
grant execute on function public.eligible_shifts_for_me() to authenticated;
grant execute on function public.eligible_workers_for_job(uuid) to authenticated;

revoke all on function public.record_match_run(uuid, text, uuid, uuid[], jsonb, text, text, text, text, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.record_match_run(uuid, text, uuid, uuid[], jsonb, text, text, text, text, integer, integer, text, text, text) to service_role;

comment on function public.eligible_shifts_for_me() is
  'Published shifts the signed-in worker already passes. Does not rank and does not call Grok.';
comment on function public.eligible_workers_for_job(uuid) is
  'Searchable workers who already pass eligibility for one job. Organization members only. No credential numbers.';
comment on function public.record_match_run(uuid, text, uuid, uuid[], jsonb, text, text, text, text, integer, integer, text, text, text) is
  'Service-role only. Drops ids that are not eligible, stores server-built explanations, writes match.run audit, and rate-limits the actor.';
