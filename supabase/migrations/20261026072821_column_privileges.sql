-- Column privileges. A table-level GRANT covers every column, so
-- REVOKE SELECT (column) in the employer migration did not hide
-- license numbers, invite token hashes, or private job coordinates.
-- This re-grants only the columns clients may read or write.
-- service_role keeps the table grants. RLS is unchanged.

revoke select on table public.organizations from public, anon, authenticated;
grant select (
  id, name, org_type, website, contact_email, contact_phone_e164, description,
  logo_path, service_counties, verification_status, verified_at, stripe_customer_id,
  created_by, created_at, updated_at
) on table public.organizations to anon, authenticated;

-- License text and organization type change only through the RPCs, which
-- reset verification and write the audit row. A direct column update would not.
revoke update (org_type, bsis_license_type, bsis_license_number)
  on table public.organizations from public, anon, authenticated;

revoke select on table public.jobs from public, anon, authenticated;
grant select (
  id, organization_id, created_by, title, description, job_type, category, is_armed,
  status, urgency, city, county, postal_code, starts_at, ends_at, recurrence_rule,
  pay_type, pay_min_cents, pay_max_cents, workers_needed, min_years_experience,
  uniform_notes, vehicle_required, equipment_notes, application_deadline,
  published_at, created_at, updated_at
) on table public.jobs to anon, authenticated;

revoke insert on table public.jobs from public, anon, authenticated;
grant insert (
  organization_id, created_by, title, description, job_type, category, is_armed,
  status, urgency, city, county, postal_code, starts_at, ends_at, recurrence_rule,
  pay_type, pay_min_cents, pay_max_cents, workers_needed, min_years_experience,
  uniform_notes, vehicle_required, equipment_notes, application_deadline
) on table public.jobs to authenticated;

revoke select on table public.organization_invites from public, anon, authenticated;
grant select (
  id, organization_id, email, role, invited_by, expires_at,
  accepted_at, accepted_by, revoked_at, created_at, updated_at
) on table public.organization_invites to authenticated;
