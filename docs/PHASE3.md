# Phase 3 — Employer / PPO portal

GuardGig.ai employer organizations, team invites, human verification, and job posts. Nothing in this phase sends email or SMS, takes payment, calls BSIS, or seeds user accounts.

## Product rules

Publishing a job while the organization is not verified does not create a public post. `public.transition_job` turns that request into `pending_review` when the job is a draft, and leaves an existing `pending_review` job there. A `BEFORE` trigger rejects a real `published` row unless `organizations.verification_status` is `verified` and `app.job_post_complete` passes. Staff verification of the organization does not publish jobs. After verification, an owner, manager, or recruiter can publish a draft or a `pending_review` job. `pending_review` means the organization is not verified yet. It is not a content-moderation queue, and this phase has no separate moderator approval of job text.

License numbers are stored trimmed and otherwise as submitted, including case and dashes. They are never checked against BSIS. They are not on the organization row clients can select, because a verified organization is readable by any signed-in user and column privileges are role-wide. Members and staff read them from `public.organization_license`. PPO, PPO branch, and proprietary private security employer rows need a license number and a contact email before `submit_organization_verification`. That is a completeness rule, not a legal determination. Changing organization type or license type/number through `update_organization` while the organization is pending or verified returns it to unverified. The audit row records `verification_reset` and does not copy the license value. Those three columns are not client-updatable, so a direct table update cannot skip the reset.

The street address lives in `job_private_locations`. Writing `jobs.site_address_private` is rejected. `jobs.site_lat` and `jobs.site_lng` are not selectable, insertable, or updatable by `anon` or `authenticated`. The public listing is city, county, and ZIP. The street is readable by organization members, staff, applicants, and assigned workers.

Employers do not receive `worker_profiles`. Search uses `public.worker_search_cards`, a trigger-maintained table of workers who opted in: display name, headline, city, county, work radius, years, preferred categories, minimum hourly rate, transportation, languages, and skills. It has no bio, security narrative, law-enforcement text, postal code, coordinates, phone, or email. Any organization member or staff may read cards. A non-searchable worker has no card row. A security-definer view over `worker_profiles` was not used, because it would bypass row security. A `security_invoker` view cannot expose a revoked column the employer is not allowed to read.

## Organizations and team

`create_organization` inserts an unverified organization and an Owner/Admin membership. A user can create at most 10 organizations. Roles are Owner/Admin, Manager, and Recruiter/Dispatcher. Membership changes are RPCs only. `om_admin_manage` is dropped, so clients have no insert, update, or delete policy on `organization_members`.

Invites are in-app. `create_organization_invite` returns a raw token once. The database stores `sha256` hex in `token_hash`, and that column is not selectable. The token is not emailed and is not written into notifications. Invites expire in 14 days. Re-inviting the same open email revokes the previous invite. The invitee must be an employer account whose profile email matches the invite. Role changes and invites are Owner/Admin only. A recruiter or manager cannot change roles. Any member may remove themselves. The last Owner/Admin cannot be demoted or removed. That trigger applies even to the table owner, except organization deletion, which sets `app.org_delete` so the cascade can remove the last owner. A client setting that GUC still cannot delete a membership, because there is no delete policy.

`organization_roster` returns display name, email, and role for co-members. Profiles stay self-or-staff, so the team page cannot read teammates from `profiles`. Phone numbers are not in the roster.

`review_organization` is staff only, cannot be used on an organization the caller belongs to or created, requires a note of at least 8 characters, writes `admin_actions` and an audit row, and notifies owners in the app. It does not insert `notification_deliveries`.

## Jobs

Types: single shift, multi-day, recurring, contract, part-time, full-time. Pay types offered in the UI are hourly, flat, and estimated. The database still has `salary`; publish rejects it. Content edits are allowed only while the job is `draft` or `pending_review`. `status` is not a client-updatable column. The trigger also requires `app.job_status_transition` before a status change, and an authenticated session that sets the GUC still cannot update the column.

Publish completeness: title at least 3 characters, description at least 20, a public city that does not look like a street, `pay_min`, pay type hourly, flat, or estimated (flat cannot have `pay_max`), and `workers_needed`. Single shifts and multi-day posts need a start and end. A single shift cannot run longer than 36 hours. Recurring posts need a start and `FREQ=WEEKLY;BYDAY=` with no duplicate days. Contract, part-time, and full-time may omit the schedule, but then both ends must be omitted. Times are America/Los_Angeles.

Allowed transitions: draft to pending review, published (if verified), or cancelled; pending review to draft, published (if verified), or cancelled; published to filled, in progress, cancelled, or expired; filled to in progress or cancelled; in progress to completed or cancelled. Completed, cancelled, and expired are terminal.

The job form says GuardGig does not employ or dispatch workers, does not set the wage, and does not confirm armed credentials. There is no conviction-history field. The job page names the organization as the hiring party.

## Routes

- `/employer`, `/employer/org`, `/employer/org/edit`, `/employer/team`, `/employer/invites/accept`
- `/employer/jobs`, `/employer/jobs/new`, `/employer/jobs/[id]`, `/employer/jobs/[id]/edit`
- `/admin/organizations`, `/admin/organizations/[id]`

Applicants and worker search stay unwired. Server actions use `EMPLOYER_MESSAGES`. Query text and raw database errors are not rendered. Logos use the private `org-logos` bucket at `{org_id}/{uuid}.{png|jpg|jpeg|webp}` after the same magic-byte sniff as avatars (2 MB). The member reads a 300-second signed URL.

## Multiple permissive policies

The six `authenticated` `SELECT` overlaps reported before this phase were consolidated in `20261026065707_employer_portal.sql` without widening read access:

| Table | Replaced policies | Replacement |
|---|---|---|
| `applications` | `app_org_read`, `app_worker_read` | `app_read` (worker, staff, or org member) |
| `job_requirements` | `jr_org_write` (`FOR ALL`, which also counted as `SELECT`) | `jr_insert`, `jr_update`, `jr_delete`; `jr_read` remains the only select |
| `jobs` | `jobs_org_read`, `jobs_public_read` | `jobs_auth_read` for `authenticated`, `jobs_anon_read` for `anon` |
| `organization_members` | `om_admin_manage` (`FOR ALL`) | dropped; `om_member_read` remains |
| `worker_availability` | `wa_owner_all` (`FOR ALL`), `wa_staff_read` | `wa_read` plus separate insert, update, and delete for the owner |
| `worker_profiles` | `wp_employer_read`, `wp_owner_read`, `wp_staff_read` | `wp_read` (owner or staff). Employer access to the full profile is removed |

`storage.objects` was not in those six. Its policies stay split so an upload rule is not merged into a delete or update rule. After `supabase db reset`, `supabase db advisors --local --type performance` reported no issues. The security advisor still reports `citext` in `public`, which has been there since the initial migration. Moving that extension is not part of this phase.

## Column privileges

`REVOKE SELECT (column)` does not remove a table-level `GRANT`. `20261026072821_column_privileges.sql` revokes table select or insert and grants the columns clients may use. Hidden from `anon` and `authenticated`: organization license columns, `organization_invites.token_hash`, and `jobs.site_address_private`, `site_lat`, and `site_lng`. License columns and `org_type` are also not client-updatable. `service_role` keeps its table grants. The app selects explicit column lists because `select *` fails when any column is withheld.

## Checks run locally

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` / `npm run build` | pass |
| `npm test` | 48 passed |
| `supabase db reset` | migrations `0000`–`0004`, `20261026065707_employer_portal`, `20261026072821_column_privileges`, and `supabase/seed.sql` |
| `npm run test:rls` | 79 passed |
| `npm run test:e2e` | 7 passed, viewport 390×844, including org → shift → moderator verify → publish → invite → recruiter |

`supabase/seed.sql` is a no-op. No user accounts are seeded.

## Deferred

- Email delivery of invites and notifications.
- Applicant flow, worker search UI over `worker_search_cards`, messaging, and payments.
- A scheduler for `mark_expired_credentials`.
- Moderator review of job text. `pending_review` is only the unverified-organization hold.
- Moving `citext` out of `public`.
- Admin MFA (AAL2) and the rest of the admin center.
