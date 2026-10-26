-- =====================================================================
-- 0000_initial_schema.sql  —  PROPOSED (Phase 0, for review; NOT applied to any Supabase project)
-- California Security Workforce Marketplace
-- Target: Supabase Postgres 15+ (depends on Supabase-provided schema `auth`,
--         function auth.uid(), and roles anon / authenticated / service_role).
-- Conventions: UUID PKs (gen_random_uuid), timestamptz created_at/updated_at,
--              FKs with explicit ON DELETE behaviour, RLS enabled on EVERY table.
-- "users": identity lives in Supabase-managed auth.users; public.profiles is the
--          1:1 application mirror. We deliberately do NOT create public.users.
-- Policies are DRAFTS: privileged writes (verification, moderation, billing,
-- audit) are performed only by server code using service_role, which bypasses RLS.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists app;   -- private helper functions (not exposed via PostgREST)

-- ---------------------------------------------------------------------
-- ENUMS (only for stable, closed vocabularies; anything business-editable
-- such as credential types or plans is a lookup table instead)
-- ---------------------------------------------------------------------
create type public.account_type as enum ('worker','employer','staff');
create type public.platform_role as enum ('user','moderator','admin','super_admin');
create type public.account_status as enum ('active','pending_verification','suspended','deactivated');
create type public.org_member_role as enum ('owner_admin','manager','recruiter_dispatcher');
create type public.org_type as enum ('ppo','private_patrol_operator_branch','proprietary_security_employer','event_company','property_management','hospital','school','retail','corporate','government','other');
create type public.verification_status as enum ('unverified','pending','verified','rejected','expired');
create type public.security_category as enum (
  'unarmed_security','armed_security','executive_protection','event_security','corporate_security',
  'residential_security','hospital_security','school_security','retail_security','loss_prevention',
  'patrol','mobile_patrol','close_protection','plainclothes','supervisor','security_manager');
create type public.job_type as enum ('single_shift','multi_day','recurring','contract','part_time','full_time');
create type public.job_status as enum ('draft','pending_review','published','filled','in_progress','completed','cancelled','expired');
create type public.job_urgency as enum ('normal','priority','urgent');
create type public.pay_type as enum ('hourly','flat','salary','estimated');
create type public.application_status as enum ('submitted','reviewing','shortlisted','interview','offered','accepted','declined','rejected','withdrawn');
create type public.assignment_status as enum ('pending_confirmation','confirmed','in_progress','completed','cancelled','no_show','disputed');
create type public.conversation_type as enum ('direct','application','assignment','support');
create type public.message_kind as enum ('text','job_card','system','attachment','voice');
create type public.notification_channel as enum ('in_app','email','sms','push');
create type public.review_status as enum ('pending_moderation','published','hidden','disputed','removed');
create type public.report_target as enum ('user','organization','job','message','review','credential');
create type public.report_status as enum ('open','triaged','actioned','dismissed');
create type public.subscription_status as enum ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused');
create type public.payment_status as enum ('pending','succeeded','failed','refunded','partially_refunded','disputed');
create type public.le_status as enum (
  'identity_unverified','identity_verified','employment_submitted','employment_verified',
  'secondary_approval_unknown','approval_pending','approval_documented','restricted','expired');
create type public.actor_type as enum ('user','admin','system','ai_assistant','ava_api','stripe_webhook');

-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------
-- IDENTITY
-- ---------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  account_type   public.account_type not null,
  platform_role  public.platform_role not null default 'user',
  status         public.account_status not null default 'active',
  display_name   text not null check (char_length(display_name) between 1 and 80),
  email          citext,
  phone_e164     text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  avatar_path    text,                    -- storage object path, never a public URL
  timezone       text not null default 'America/Los_Angeles',
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index profiles_account_type_idx on public.profiles(account_type);
create index profiles_platform_role_idx on public.profiles(platform_role) where platform_role <> 'user';

-- ---------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER, fixed search_path, in private schema)
-- ---------------------------------------------------------------------
create or replace function app.current_platform_role() returns public.platform_role
language sql stable security definer set search_path = '' as $$
  select p.platform_role from public.profiles p where p.id = auth.uid()
$$;
create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_platform_role() in ('moderator','admin','super_admin'), false)
$$;
create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_platform_role() in ('admin','super_admin'), false)
$$;

-- ---------------------------------------------------------------------
-- WORKERS
-- ---------------------------------------------------------------------
create table public.worker_profiles (
  user_id               uuid primary key references public.profiles(id) on delete cascade,
  headline              text check (char_length(headline) <= 140),
  bio                   text check (char_length(bio) <= 4000),
  city                  text,
  county                text,
  postal_code           text,
  -- approximate location only (centroid of ZIP/city), never home address
  approx_lat            numeric(8,5) check (approx_lat between -90 and 90),
  approx_lng            numeric(8,5) check (approx_lng between -180 and 180),
  work_radius_miles     integer check (work_radius_miles between 1 and 500),
  years_experience      smallint check (years_experience between 0 and 70),
  has_le_experience     boolean not null default false,
  preferred_categories  public.security_category[] not null default '{}',
  min_hourly_rate_cents integer check (min_hourly_rate_cents >= 0),
  has_transportation    boolean,
  languages             text[] not null default '{}',
  skills                text[] not null default '{}',
  is_searchable         boolean not null default false,   -- opt-in to employer search
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index worker_profiles_geo_idx on public.worker_profiles(approx_lat, approx_lng) where is_searchable;
create index worker_profiles_categories_idx on public.worker_profiles using gin(preferred_categories);

-- ---------------------------------------------------------------------
-- ORGANIZATIONS / EMPLOYERS
-- ---------------------------------------------------------------------
create table public.organizations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(name) between 1 and 200),
  org_type              public.org_type not null,
  website               text,
  contact_email         citext,
  contact_phone_e164    text,
  description           text check (char_length(description) <= 5000),
  logo_path             text,
  service_counties      text[] not null default '{}',
  -- License data is ENTERED by employer and only marked verified by staff after a
  -- verification event recorded in credential_verifications/admin_actions.
  bsis_license_type     text,
  bsis_license_number   text,
  verification_status   public.verification_status not null default 'unverified',
  verified_at           timestamptz,
  stripe_customer_id    text unique,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index organizations_verification_idx on public.organizations(verification_status);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            public.org_member_role not null,
  invited_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);

create table public.employer_profiles (
  user_id                 uuid primary key references public.profiles(id) on delete cascade,
  primary_organization_id uuid references public.organizations(id) on delete set null,
  job_title               text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create or replace function app.is_org_member(p_org uuid, p_roles public.org_member_role[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid()
      and (p_roles is null or m.role = any(p_roles)))
$$;

-- ---------------------------------------------------------------------
-- CREDENTIALS
-- ---------------------------------------------------------------------
create table public.credential_types (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,  -- e.g. 'ca_guard_registration','ca_exposed_firearm_permit','ca_baton_permit','cpr_aed','first_aid','taser','oc','ep_training','drivers_license','other'
  name               text not null,
  issuing_authority  text,                  -- e.g. 'CA BSIS', 'CA DMV'
  is_state_license   boolean not null default false,
  requires_document  boolean not null default true,
  has_expiration     boolean not null default true,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.credentials (
  id                  uuid primary key default gen_random_uuid(),
  worker_id           uuid not null references public.worker_profiles(user_id) on delete cascade,
  credential_type_id  uuid not null references public.credential_types(id) on delete restrict,
  credential_number   text,               -- sensitive; masked in UI, never sent to AI
  issued_on           date,
  expires_on          date,
  document_path       text,               -- private bucket 'credential-documents'
  -- status is written ONLY by server/service_role after a verification event
  status              public.verification_status not null default 'unverified',
  last_verification_id uuid,              -- FK added below
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index credentials_worker_idx on public.credentials(worker_id);
create index credentials_type_status_idx on public.credentials(credential_type_id, status);
create index credentials_expiry_idx on public.credentials(expires_on) where status = 'verified';

create table public.credential_verifications (
  id                uuid primary key default gen_random_uuid(),
  credential_id     uuid not null references public.credentials(id) on delete cascade,
  result_status     public.verification_status not null,
  method            text not null check (method in ('bsis_public_lookup','document_review','issuer_contact','third_party_api','other')),
  source_reference  text,                 -- e.g. lookup URL / ticket ref; required for 'verified'
  notes             text,
  verified_by       uuid references public.profiles(id) on delete set null,
  verified_at       timestamptz not null default now(),
  valid_until       date,
  created_at        timestamptz not null default now(),
  check (result_status <> 'verified' or (verified_by is not null and source_reference is not null))
);
create index credential_verifications_credential_idx on public.credential_verifications(credential_id, verified_at desc);
alter table public.credentials add constraint credentials_last_verification_fk
  foreign key (last_verification_id) references public.credential_verifications(id) on delete set null;

-- ---------------------------------------------------------------------
-- OFF-DUTY LAW ENFORCEMENT (separate workflow, NOT a credential)  [addition]
-- ---------------------------------------------------------------------
create table public.le_officer_profiles (
  worker_id                 uuid primary key references public.worker_profiles(user_id) on delete cascade,
  agency_name               text not null,
  agency_type               text,
  status                    public.le_status not null default 'identity_unverified',
  identity_verified_at      timestamptz,
  employment_verified_at    timestamptz,
  secondary_approval_doc_path text,        -- private bucket
  secondary_approval_expires_on date,
  restrictions              text,
  reviewed_by               uuid references public.profiles(id) on delete set null,
  reverify_after            date,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- AVAILABILITY
-- ---------------------------------------------------------------------
create table public.worker_availability (
  id            uuid primary key default gen_random_uuid(),
  worker_id     uuid not null references public.worker_profiles(user_id) on delete cascade,
  -- either a recurring weekly window or a one-off dated window
  weekday       smallint check (weekday between 0 and 6),
  start_time    time,
  end_time      time,
  starts_at     timestamptz,
  ends_at       timestamptz,
  is_available  boolean not null default true,   -- false = blackout
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((weekday is not null and start_time is not null and end_time is not null and starts_at is null)
      or (weekday is null and starts_at is not null and ends_at is not null and ends_at > starts_at))
);
create index worker_availability_worker_idx on public.worker_availability(worker_id);
create index worker_availability_range_idx on public.worker_availability(starts_at, ends_at) where starts_at is not null;

-- ---------------------------------------------------------------------
-- JOBS
-- ---------------------------------------------------------------------
create table public.jobs (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  created_by            uuid references public.profiles(id) on delete set null,
  title                 text not null check (char_length(title) between 3 and 140),
  description           text not null check (char_length(description) <= 10000),
  job_type              public.job_type not null,
  category              public.security_category not null,
  is_armed              boolean not null default false,
  status                public.job_status not null default 'draft',
  urgency               public.job_urgency not null default 'normal',
  city                  text,
  county                text,
  postal_code           text,
  site_lat              numeric(8,5),
  site_lng              numeric(8,5),
  site_address_private  text,             -- disclosed only to assigned workers (server-side)
  starts_at             timestamptz,
  ends_at               timestamptz,
  recurrence_rule       text,             -- RFC 5545 RRULE for recurring
  pay_type              public.pay_type not null,
  pay_min_cents         integer check (pay_min_cents >= 0),
  pay_max_cents         integer check (pay_max_cents >= 0),
  workers_needed        smallint not null default 1 check (workers_needed between 1 and 500),
  min_years_experience  smallint check (min_years_experience >= 0),
  uniform_notes         text,
  vehicle_required      boolean not null default false,
  equipment_notes       text,
  application_deadline  timestamptz,
  published_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (pay_max_cents is null or pay_min_cents is null or pay_max_cents >= pay_min_cents)
);
create index jobs_org_idx on public.jobs(organization_id);
create index jobs_marketplace_idx on public.jobs(status, starts_at) where status = 'published';
create index jobs_category_idx on public.jobs(category, is_armed) where status = 'published';
create index jobs_geo_idx on public.jobs(site_lat, site_lng) where status = 'published';
create index jobs_pay_idx on public.jobs(pay_min_cents) where status = 'published';

create table public.job_requirements (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs(id) on delete cascade,
  credential_type_id  uuid references public.credential_types(id) on delete restrict,
  is_mandatory        boolean not null default true,   -- mandatory = hard eligibility filter
  requirement_text    text,
  created_at          timestamptz not null default now(),
  unique (job_id, credential_type_id)
);
create index job_requirements_job_idx on public.job_requirements(job_id);

-- ---------------------------------------------------------------------
-- APPLICATIONS / ASSIGNMENTS
-- ---------------------------------------------------------------------
create table public.applications (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs(id) on delete cascade,
  worker_id        uuid not null references public.worker_profiles(user_id) on delete cascade,
  status           public.application_status not null default 'submitted',
  cover_note       text check (char_length(cover_note) <= 4000),
  submitted_via    public.actor_type not null default 'user',   -- 'ava_api' when via AVA (after confirmation)
  status_changed_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (job_id, worker_id)
);
create index applications_worker_idx on public.applications(worker_id, status);
create index applications_job_idx on public.applications(job_id, status);

create table public.assignments (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs(id) on delete restrict,
  application_id  uuid unique references public.applications(id) on delete set null,
  worker_id       uuid not null references public.worker_profiles(user_id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  status          public.assignment_status not null default 'pending_confirmation',
  starts_at       timestamptz,
  ends_at         timestamptz,
  worker_confirmed_at   timestamptz,     -- explicit human confirmation required
  employer_confirmed_at timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index assignments_worker_idx on public.assignments(worker_id, status);
create index assignments_org_idx on public.assignments(organization_id, status);
create index assignments_job_idx on public.assignments(job_id);

-- ---------------------------------------------------------------------
-- MESSAGING
-- ---------------------------------------------------------------------
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  type             public.conversation_type not null default 'direct',
  organization_id  uuid references public.organizations(id) on delete set null,
  job_id           uuid references public.jobs(id) on delete set null,
  application_id   uuid references public.applications(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index conversations_last_msg_idx on public.conversations(last_message_at desc);

create table public.conversation_members (
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  last_read_at     timestamptz,
  archived_at      timestamptz,
  muted            boolean not null default false,
  joined_at        timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members(user_id);

create or replace function app.is_conversation_member(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members cm
                 where cm.conversation_id = p_conv and cm.user_id = auth.uid())
$$;

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid references public.profiles(id) on delete set null,
  kind             public.message_kind not null default 'text',
  body             text check (char_length(body) <= 8000),
  job_id           uuid references public.jobs(id) on delete set null,  -- for job_card
  edited_at        timestamptz,
  deleted_at       timestamptz,
  is_flagged       boolean not null default false,
  created_at       timestamptz not null default now()
);
create index messages_conversation_idx on public.messages(conversation_id, created_at desc);
create index messages_sender_idx on public.messages(sender_id);

create table public.message_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  storage_path  text not null,            -- private bucket 'message-attachments'
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  scan_status   text not null default 'pending' check (scan_status in ('pending','clean','infected','error')),
  created_at    timestamptz not null default now()
);
create index message_attachments_message_idx on public.message_attachments(message_id);

create table public.user_blocks (   -- [addition] block user
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  event_type  text not null,   -- 'job_match','application_received','new_message','offer','urgent_shift','credential_expiring',...
  title       text not null,
  body        text,
  link_path   text,
  data        jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;

create table public.notification_preferences (   -- [addition]
  user_id     uuid not null references public.profiles(id) on delete cascade,
  event_type  text not null,
  channel     public.notification_channel not null,
  enabled     boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end   time,
  updated_at  timestamptz not null default now(),
  primary key (user_id, event_type, channel)
);

create table public.notification_deliveries (   -- [addition] outbound email/SMS/push log + idempotency
  id                uuid primary key default gen_random_uuid(),
  notification_id   uuid references public.notifications(id) on delete cascade,
  channel           public.notification_channel not null,
  provider          text,             -- 'resend','twilio'
  provider_message_id text,
  status            text not null default 'queued' check (status in ('queued','sent','delivered','failed','suppressed')),
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index notification_deliveries_notification_idx on public.notification_deliveries(notification_id);

-- ---------------------------------------------------------------------
-- SAVED
-- ---------------------------------------------------------------------
create table public.saved_jobs (
  worker_id  uuid not null references public.worker_profiles(user_id) on delete cascade,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (worker_id, job_id)
);
create table public.saved_workers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  worker_id       uuid not null references public.worker_profiles(user_id) on delete cascade,
  saved_by        uuid references public.profiles(id) on delete set null,
  roster_name     text,
  note            text,
  created_at      timestamptz not null default now(),
  primary key (organization_id, worker_id)
);

-- ---------------------------------------------------------------------
-- REVIEWS / REPORTS
-- ---------------------------------------------------------------------
create table public.reviews (
  id                uuid primary key default gen_random_uuid(),
  assignment_id     uuid not null references public.assignments(id) on delete cascade,
  reviewer_id       uuid not null references public.profiles(id) on delete cascade,
  direction         text not null check (direction in ('worker_to_employer','employer_to_worker')),
  reviewee_user_id  uuid references public.profiles(id) on delete cascade,
  reviewee_org_id   uuid references public.organizations(id) on delete cascade,
  ratings           jsonb not null,   -- {"professionalism":5,"communication":4,...}; validated server-side
  comment           text check (char_length(comment) <= 2000),
  status            public.review_status not null default 'pending_moderation',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (assignment_id, reviewer_id),
  check (num_nonnulls(reviewee_user_id, reviewee_org_id) = 1)
);
create index reviews_reviewee_user_idx on public.reviews(reviewee_user_id) where status = 'published';
create index reviews_reviewee_org_idx on public.reviews(reviewee_org_id) where status = 'published';

create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid references public.profiles(id) on delete set null,
  target_type   public.report_target not null,
  target_id     uuid not null,          -- polymorphic; validated server-side
  reason        text not null check (reason in ('fake_job','fake_credential','phishing','harassment','spam','payment_scam','inappropriate','safety','other')),
  details       text check (char_length(details) <= 4000),
  status        public.report_status not null default 'open',
  assigned_to   uuid references public.profiles(id) on delete set null,
  resolution    text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index reports_status_idx on public.reports(status, created_at);
create index reports_target_idx on public.reports(target_type, target_id);

-- ---------------------------------------------------------------------
-- BILLING (Stripe is source of truth; rows written only by webhook handler)
-- ---------------------------------------------------------------------
create table public.plans (   -- [addition] configurable pricing/entitlements
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,     -- 'worker_free','employer_starter','employer_professional','employer_enterprise'
  name             text not null,
  audience         public.account_type not null,
  stripe_price_id  text unique,
  entitlements     jsonb not null default '{}',  -- {"active_job_posts":3,"candidate_search":false,...}
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid references public.organizations(id) on delete restrict,
  user_id                 uuid references public.profiles(id) on delete restrict,   -- future Worker Pro
  plan_id                 uuid not null references public.plans(id) on delete restrict,
  stripe_subscription_id  text not null unique,
  status                  public.subscription_status not null,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (num_nonnulls(organization_id, user_id) = 1)
);
create index subscriptions_org_idx on public.subscriptions(organization_id);

create table public.payments (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid references public.organizations(id) on delete restrict,
  subscription_id           uuid references public.subscriptions(id) on delete set null,
  stripe_invoice_id         text unique,
  stripe_payment_intent_id  text unique,
  amount_cents              integer not null check (amount_cents >= 0),
  currency                  char(3) not null default 'usd',
  status                    public.payment_status not null,
  paid_at                   timestamptz,
  created_at                timestamptz not null default now()
);
create index payments_org_idx on public.payments(organization_id, created_at desc);

create table public.stripe_events (   -- [addition] webhook idempotency
  id            text primary key,     -- Stripe event id
  type          text not null,
  payload       jsonb not null,
  processed_at  timestamptz,
  error         text,
  received_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- AUDIT / ADMIN / AI / AVA
-- ---------------------------------------------------------------------
create table public.audit_logs (   -- append-only
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_type    public.actor_type not null,
  actor_id      uuid,
  organization_id uuid,
  action        text not null,          -- 'credential.verify','application.submit','job.publish',...
  entity_type   text not null,
  entity_id     uuid,
  before_data   jsonb,
  after_data    jsonb,
  ip_address    inet,
  user_agent    text,
  request_id    text
);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, occurred_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, occurred_at desc);

create or replace function app.audit_logs_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_logs is append-only'; end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function app.audit_logs_immutable();

create table public.admin_actions (
  id              uuid primary key default gen_random_uuid(),
  admin_id        uuid not null references public.profiles(id) on delete restrict,
  action          text not null,   -- 'suspend_user','verify_credential','remove_job','reinstate',...
  target_type     text not null,
  target_id       uuid not null,
  reason          text not null,
  confirmed_at    timestamptz,     -- second-step confirmation for high-impact actions
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index admin_actions_target_idx on public.admin_actions(target_type, target_id);
create index admin_actions_admin_idx on public.admin_actions(admin_id, created_at desc);

create table public.ai_tool_calls (   -- [addition] AI usage, cost and tool-call audit
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles(id) on delete set null,
  session_id      uuid,
  tool_name       text not null,
  arguments       jsonb not null default '{}',
  result_summary  jsonb,
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  required_confirmation boolean not null default false,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index ai_tool_calls_user_idx on public.ai_tool_calls(user_id, created_at desc);

create table public.api_clients (   -- [addition] AVA & future integrations (scoped tokens)
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  owner_user_id   uuid references public.profiles(id) on delete cascade,
  key_hash        text not null unique,          -- store hash only, never the raw key
  scopes          text[] not null default '{}',  -- 'jobs:read','applications:read','applications:draft','applications:submit_confirmed','messages:read','messages:draft','notifications:read'
  rate_limit_per_min integer not null default 60,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['profiles','worker_profiles','organizations','organization_members','employer_profiles',
    'credential_types','credentials','le_officer_profiles','worker_availability','jobs','applications','assignments',
    'conversations','notification_deliveries','reviews','reports','plans','subscriptions']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t, t);
  end loop;
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY — enabled on every public table; default deny.
-- =====================================================================
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('alter table public.%I force row level security', r.tablename);
  end loop;
end $$;

-- profiles: own row; staff read. Role/status changes are server-only (column grants below).
create policy profiles_select_self on public.profiles for select to authenticated using (id = auth.uid() or app.is_staff());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (display_name, phone_e164, avatar_path, timezone) on public.profiles to authenticated;

-- worker_profiles: owner full; employers (any org member) see searchable profiles; staff read.
create policy wp_owner_all on public.worker_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy wp_employer_read on public.worker_profiles for select to authenticated
  using (is_searchable and exists (select 1 from public.organization_members m where m.user_id = auth.uid()));
create policy wp_staff_read on public.worker_profiles for select to authenticated using (app.is_staff());

-- organizations: members read; owner_admin updates non-verification fields; verified orgs public-readable.
create policy org_member_read on public.organizations for select to authenticated using (app.is_org_member(id) or verification_status = 'verified' or app.is_staff());
create policy org_admin_update on public.organizations for update to authenticated
  using (app.is_org_member(id, array['owner_admin']::public.org_member_role[]))
  with check (app.is_org_member(id, array['owner_admin']::public.org_member_role[]));
revoke update on public.organizations from authenticated;
grant update (name, website, contact_email, contact_phone_e164, description, logo_path, service_counties, bsis_license_type, bsis_license_number) on public.organizations to authenticated;
-- org creation goes through a server route (creates org + owner membership atomically).

create policy om_member_read on public.organization_members for select to authenticated using (app.is_org_member(organization_id) or app.is_staff());
create policy om_admin_manage on public.organization_members for all to authenticated
  using (app.is_org_member(organization_id, array['owner_admin']::public.org_member_role[]))
  with check (app.is_org_member(organization_id, array['owner_admin']::public.org_member_role[]));

create policy ep_owner_all on public.employer_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- credential_types: readable by everyone signed in.
create policy ct_read on public.credential_types for select to authenticated using (true);

-- credentials: owner reads/inserts/updates (status column NOT granted); staff read.
-- Employers never read this table directly; they get a server-computed
-- "verified credential summary" (type + verified + expiry month) via API.
create policy cred_owner_read on public.credentials for select to authenticated using (worker_id = auth.uid() or app.is_staff());
create policy cred_owner_insert on public.credentials for insert to authenticated with check (worker_id = auth.uid() and status = 'unverified');
create policy cred_owner_update on public.credentials for update to authenticated using (worker_id = auth.uid()) with check (worker_id = auth.uid());
create policy cred_owner_delete on public.credentials for delete to authenticated using (worker_id = auth.uid() and status <> 'verified');
revoke update on public.credentials from authenticated;
grant update (credential_number, issued_on, expires_on, document_path) on public.credentials to authenticated;

create policy cv_read on public.credential_verifications for select to authenticated
  using (app.is_staff() or exists (select 1 from public.credentials c where c.id = credential_id and c.worker_id = auth.uid()));
-- no insert/update policy: service_role only.

create policy le_owner_read on public.le_officer_profiles for select to authenticated using (worker_id = auth.uid() or app.is_staff());
create policy le_owner_insert on public.le_officer_profiles for insert to authenticated with check (worker_id = auth.uid() and status = 'identity_unverified');

create policy wa_owner_all on public.worker_availability for all to authenticated using (worker_id = auth.uid()) with check (worker_id = auth.uid());
create policy wa_staff_read on public.worker_availability for select to authenticated using (app.is_staff());
-- employer availability visibility is served via server API (coarse "available for shift" boolean only).

-- jobs: published visible to all signed-in users and anon (marketplace browse); org members manage own.
create policy jobs_public_read on public.jobs for select to anon, authenticated using (status = 'published');
create policy jobs_org_read on public.jobs for select to authenticated using (app.is_org_member(organization_id) or app.is_staff());
create policy jobs_org_write on public.jobs for insert to authenticated
  with check (app.is_org_member(organization_id) and status in ('draft','pending_review'));
create policy jobs_org_update on public.jobs for update to authenticated
  using (app.is_org_member(organization_id)) with check (app.is_org_member(organization_id));
-- NOTE: site_address_private must be excluded from anon/worker reads — expose jobs via a view
-- (public.jobs_public) or column grants in Phase 3/4.

create policy jr_read on public.job_requirements for select to anon, authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and (j.status = 'published' or app.is_org_member(j.organization_id))));
create policy jr_org_write on public.job_requirements for all to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and app.is_org_member(j.organization_id)))
  with check (exists (select 1 from public.jobs j where j.id = job_id and app.is_org_member(j.organization_id)));

-- applications: worker owns; org members of the job's org read; status transitions via server.
create policy app_worker_read on public.applications for select to authenticated using (worker_id = auth.uid());
create policy app_worker_insert on public.applications for insert to authenticated
  with check (worker_id = auth.uid() and status = 'submitted'
              and exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published'));
create policy app_org_read on public.applications for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and app.is_org_member(j.organization_id)) or app.is_staff());
revoke update on public.applications from authenticated;   -- withdraw/advance via server routes

create policy asg_read on public.assignments for select to authenticated
  using (worker_id = auth.uid() or app.is_org_member(organization_id) or app.is_staff());
-- writes: server only (requires explicit worker + employer confirmation).

-- messaging
create policy conv_member_read on public.conversations for select to authenticated using (app.is_conversation_member(id));
create policy cm_member_read on public.conversation_members for select to authenticated using (app.is_conversation_member(conversation_id));
create policy cm_self_update on public.conversation_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.conversation_members from authenticated;
grant update (last_read_at, archived_at, muted) on public.conversation_members to authenticated;
create policy msg_member_read on public.messages for select to authenticated using (app.is_conversation_member(conversation_id));
create policy msg_member_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and kind in ('text','job_card','attachment') and app.is_conversation_member(conversation_id)
              and not exists (select 1 from public.conversation_members o join public.user_blocks b
                               on b.blocker_id = o.user_id and b.blocked_id = auth.uid()
                               where o.conversation_id = messages.conversation_id));
create policy ma_member_read on public.message_attachments for select to authenticated using (app.is_conversation_member(conversation_id));

create policy ub_owner_all on public.user_blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

create policy notif_owner_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_owner_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy np_owner_all on public.notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy sj_owner_all on public.saved_jobs for all to authenticated using (worker_id = auth.uid()) with check (worker_id = auth.uid());
create policy sw_org_all on public.saved_workers for all to authenticated
  using (app.is_org_member(organization_id)) with check (app.is_org_member(organization_id));

create policy rev_public_read on public.reviews for select to authenticated
  using (status = 'published' or reviewer_id = auth.uid() or app.is_staff());
-- insert via server: verifies reviewer was party to a completed assignment.

create policy rep_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid() and status = 'open');
create policy rep_read on public.reports for select to authenticated using (reporter_id = auth.uid() or app.is_staff());

create policy plans_read on public.plans for select to anon, authenticated using (is_active);
create policy subs_org_read on public.subscriptions for select to authenticated
  using (app.is_org_member(organization_id, array['owner_admin']::public.org_member_role[]) or user_id = auth.uid() or app.is_admin());
create policy pay_org_read on public.payments for select to authenticated
  using (app.is_org_member(organization_id, array['owner_admin']::public.org_member_role[]) or app.is_admin());

create policy audit_admin_read on public.audit_logs for select to authenticated using (app.is_admin());
create policy aa_admin_read on public.admin_actions for select to authenticated using (app.is_admin());
create policy ai_owner_read on public.ai_tool_calls for select to authenticated using (user_id = auth.uid() or app.is_admin());
create policy api_owner_read on public.api_clients for select to authenticated using (owner_user_id = auth.uid() or app.is_admin());
-- stripe_events: no policies => no client access (service_role only).

-- Lock down private helper schema
revoke all on schema app from public;
grant usage on schema app to authenticated, anon;
grant execute on all functions in schema app to authenticated, anon;

-- =====================================================================
-- STORAGE (to be created in Phase 1 via Supabase dashboard/CLI; documented here):
--   buckets (ALL private): credential-documents, le-documents, message-attachments,
--                          avatars (private, served via signed URL), org-logos
--   Path convention: {owner_uuid}/{object_uuid}.{ext}; policies on storage.objects
--   check (storage.foldername(name))[1] = auth.uid()::text; reads by others only via
--   server-issued short-lived signed URLs (<= 60s for credential docs).
-- =====================================================================
