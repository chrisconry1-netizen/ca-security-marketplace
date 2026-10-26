# Phase 2 — Worker Profiles & Credentials

Mobile-first worker profile, availability, and credential intake. Verification is a recorded human decision. Nothing in this phase calls BSIS, a background-check vendor, a geocoder, or an email/SMS provider.

## What shipped

- Worker profile create/edit/view: display name, private profile photo, city / county / ZIP, work radius, headline, bio, years and narrative security experience, optional law-enforcement context, preferred security categories, minimum hourly pay, transportation, languages, skills, searchable opt-in.
- Availability: recurring Pacific-time weekly windows and date exceptions (including overnight).
- Credentials: seeded types, number, issuer, issue/expiry dates, private document upload, status machine, moderator review queue, expiry sweep that writes in-app notifications only.
- Advisor follow-ups in `0004_advisor_hardening.sql` (search_path, initplan `auth.uid()`, foreign-key indexes) plus RLS tests that the definers `my_roles`, `select_account_type`, and `record_auth_event` cannot escalate `platform_role`.

## Profile data

`worker_profiles` gained `security_experience` and `le_experience_summary`. There is still no street column. City, county, and ZIP are rejected when they look like a street address. Latitude and longitude stay null; this phase does not geocode. `is_searchable` stays opt-in and defaults to false. Law-enforcement text is something the worker chooses to share. The UI says it is not a verification and does not authorize off-duty work. `le_officer_profiles` is unchanged and is not part of this flow.

Preferred assignments use the existing `security_category` enum: Unarmed, Armed, Executive Protection, Event, Corporate, Residential, Hospital, School, Retail, Loss Prevention, Patrol, Mobile Patrol, Close Protection, Plainclothes, Supervisor, Security Manager.

Photos go to the private `avatars` bucket at `{user_uuid}/{uuid}.{png|jpg|jpeg|webp}` after magic-byte sniffing (2 MB). The owner reads them through a 300-second signed URL. The server generates the path.

## Credentials

Seeded `credential_types` (insert is `on conflict (code) do nothing`):

| Code | Name |
|---|---|
| `ca_guard_registration` | CA Guard Registration (BSIS) |
| `ca_exposed_firearm_permit` | Exposed Firearm Permit |
| `ca_baton_permit` | Baton Permit |
| `cpr_aed` | CPR/AED |
| `first_aid` | First Aid |
| `taser` | Taser |
| `oc` | OC |
| `ep_training` | Executive Protection training |
| `drivers_license` | Driver's license |
| `other` | Other |

Documents go to the private `credential-documents` bucket at `{worker_uuid}/{uuid}.{pdf|jpg|jpeg|png|heic}` (10 MB, sniffed). Clients cannot update or delete objects. Replacing a document leaves the previous object in place. Owner signed URLs last 60 seconds and are audited as `credential.document_url_issued` (TTL only, not the URL or the number). Staff review uses the service-role signer only after `requireRole`, and only while the credential is pending, with the same audit.

### Status machine

New rows must be `unverified`. A `BEFORE` trigger rejects every other status change unless the session GUC `app.credential_status_transition` is `submit`, `verify`, or `expire`. `service_role` bypasses RLS and still hits the trigger.

- `submit_credential`: owner only, `unverified` or `rejected` → `pending`. Requires number, issuer, issued date, expiry when the type has one, and a document when the type requires one. Audits `credential.submit`. It cannot set `verified` or `rejected`.
- `review_credential`: moderator, admin, or super_admin, active account, cannot review their own credential, `pending` only, result `verified` or `rejected`. Verified requires a source reference and an expiry that is not already past (Pacific calendar). Rejected requires notes. Inserts `credential_verifications`, then sets status and `last_verification_id`, plus `admin_actions`, an audit row that does not contain the credential number, and an in-app notification. It does not call BSIS. The Next.js action calls the RPC with the moderator's user JWT so `verified_by` is that person.
- Workers can edit or delete only `unverified` and `rejected` rows. Document paths are checked in RLS and the trigger.

`public.credential_time_state(status, expires_on)` returns `expired`, `expiring_soon`, `valid`, or `none`. Expiring soon is a verified credential whose expiry is within 30 Pacific days, including today. A past date on a rejected credential stays `valid` so the badge remains rejected. The same rules are in `src/lib/workers/expiry.ts`.

`public.mark_expired_credentials()` is granted to `service_role` only. It refuses a JWT whose role is anything else. It marks `unverified`, `pending`, and `verified` rows with `expires_on` before Pacific today as `expired`, and inserts idempotent in-app notifications `credential_expired` and `credential_expiring`. It does not insert `notification_deliveries` and does not send email or SMS. Nothing in this repo schedules it yet; a later worker or `pg_cron` job should call it with the service role.

## Advisor migration

`0004_advisor_hardening.sql` is additive:

- `search_path = ''` on `app.audit_logs_immutable`, `app.set_updated_at`, and `app.try_uuid`.
- Policy predicates rewritten to `(select auth.uid())`. Predicates are otherwise unchanged. Credential insert/delete policies from `0003` are not recreated.
- `app.current_platform_role`, `app.is_org_member`, and `app.is_conversation_member` also read `(select auth.uid())`.
- Execute on `app.handle_new_user` and `app.sync_user_email` revoked from `public` / `anon` / `authenticated` and granted to `supabase_auth_admin`.
- Execute on `app.audit_logs_immutable` revoked from those roles and granted to `service_role`.
- Indexes on public foreign keys that had no usable leading index. `notifications.user_id` previously had only a partial unread index, which does not cover rows that have been read, so a full index was added.
- A closing check fails the migration if any public foreign key still lacks a non-partial index whose leading columns match the key. Index keys are read with `string_to_array(indkey::text, ' ')::smallint[]` because a direct cast of `int2vector` does not slice correctly.

## RLS notes kept from Phase 1

An employer sees a searchable worker profile only when they are an `organization_members` row. Account type `employer` alone is not enough. Staff read profiles through `app.is_staff()`. Clients still cannot update `profiles.platform_role`, `credentials.status`, or insert `credential_verifications`.

## App routes

- `/worker/profile`, `/worker/profile/edit`
- `/worker/credentials`, `/worker/credentials/new`, `/worker/credentials/[id]`
- `/worker/availability`
- `/admin/verification`, `/admin/verification/[id]` (basic queue; the admin center is Phase 10)

Server actions use fixed message catalogues. Query text is not rendered.

## Checks run locally

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` / `npm run build` | pass |
| `npm test` | 43 passed |
| `supabase start` then `supabase db reset` | migrations `0000`–`0004` and `supabase/seed.sql` applied |
| `npm run test:rls` | 65 passed (Phase 1 suite plus Phase 2 isolation, self-verify denial, expiry sweep, advisor checks, definer escalation) |
| `npm run test:e2e` | 6 passed, viewport 390×844, including profile → credential → moderator verify |

`supabase/seed.sql` is a no-op. Reference rows live in migrations. No user accounts are seeded.

## Deferred

- Email/SMS delivery of credential notifications (the in-app row is the hook).
- A scheduler calling `mark_expired_credentials`.
- Full admin center, admin MFA (AAL2), employer search projections that hide bio, BSIS or any other registry client, background checks, geocoding.
