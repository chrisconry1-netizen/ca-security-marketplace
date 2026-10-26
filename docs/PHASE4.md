# Phase 4 — Job & Shift Marketplace

Mobile-first answer to “What’s available for me to work?” Workers search published shifts, open a public detail page, save or apply, and accept or decline an offer. Employers post shifts and move applications. Nothing in this phase sends email, SMS, or payments, and nothing accepts or rejects an application on its own.

## What shipped

- Public search at `/jobs` and the signed-in worker view at `/worker/shifts`, plus saved shifts and application tracking.
- Filters: city, county, near a city or ZIP with a radius, minimum pay, date, day/swing/night, time window, security category, armed/unarmed, required credential, years of experience, employer name, and job type. Default order is urgent, then priority, then soonest start. Page size is 20.
- “Eligible for me” uses the signed-in worker’s **verified** credentials only. Pending, rejected, and expired credentials do not count.
- Job cards and `/jobs/[id]`: public city/area, employer-entered pay, Pacific times, requirements, and a verified-employer badge read from `organizations.verification_status`. Share uses the Web Share API, then the clipboard. Only a published shift is on the public page.
- Save, apply with an optional note, withdraw, and accept or decline an offer.
- Employer organization create, draft shifts, publish, and an applicant list of minimized worker cards (display name, city, county, years, note, verified credential name and expiry). Credential numbers and documents are not on that card.
- In-app notifications only. No `notification_deliveries` rows.

## Location

Geocoding is not called. PostGIS is not installed. Distance is a latitude/longitude bounding box plus haversine miles (`app.miles_between`) on **public approximate coordinates**.

`jobs.approx_lat` / `approx_lng` are rounded to 0.01 degrees (about a kilometer). A trigger fills them from `public.place_centroids` when the employer does not enter an approximate point. Postal code wins over city. The private site pin is never copied into the public point. The centroid table is reference data seeded in `20261026120000_job_marketplace.sql` (California city centers and a smaller ZIP set). An unknown city has no radius until a centroid or an employer-entered approximate point exists.

`jobs.site_address_private`, `site_lat`, and `site_lng` are not selectable by `anon` or `authenticated`. The street is stored in `job_private_locations`. `public.job_private_site` returns that street, with null coordinates, only to an organization member, staff, or a worker with an assignment in `pending_confirmation`, `confirmed`, `in_progress`, `completed`, or `disputed`. Accepting an offer creates that assignment, which is what the public page uses to reveal the address. Phase 3’s table policy is wider and is described in `docs/PHASE3.md`.

## Eligibility

Applying is **blocked**, not warned, when a mandatory rule is missing.

- Armed shifts require a verified, unexpired `ca_guard_registration` and `ca_exposed_firearm_permit` even when those types are not listed on the shift. The error is `armed credential missing`.
- Each mandatory `job_requirements` row with a credential type must be verified, and `expires_on` must be null or on/after the shift’s Pacific date (or Pacific today when the shift has no start). The error is `mandatory credential missing`.
- Optional requirements, free-text requirements, and years of experience do not block apply. Years are a search filter only.
- “Eligible for me” uses the same credential rule.

A credential that expires on the shift date still counts (`expires_on >= shift date`).

## Applications and assignments

Statuses: `submitted`, `reviewing`, `shortlisted`, `interview`, `offered`, `accepted`, `declined`, `rejected`, `withdrawn`.

`app.guard_application_write` is authoritative. `src/lib/jobs/state.ts` mirrors it.

- A worker may submit, withdraw from an open status (`submitted` through `offered`), and accept or decline an `offered` row.
- An organization member (`owner_admin`, `manager`, or `recruiter_dispatcher`; there is no finer permission matrix) may move `submitted` / `reviewing` / `shortlisted` / `interview` to `reviewing` / `shortlisted` / `interview` / `offered` / `rejected`, and may reject an offer. They cannot set `accepted`, `declined`, `withdrawn`, or `submitted`.
- `accepted`, `declined`, `rejected`, and `withdrawn` are terminal. A withdrawn worker cannot apply again: the unique `(job_id, worker_id)` row remains.
- Direct inserts are denied. `submit_application` is the only insert path.
- Duplicate applications, unpublished shifts, expired deadlines or end times, and filled shifts (`active` assignment count ≥ `workers_needed`) are rejected. Active assignment statuses are `pending_confirmation`, `confirmed`, `in_progress`, `completed`, and `disputed`.
- Job status does **not** flip to `filled` or `expired` by itself. Apply and accept still refuse those conditions.
- `accept_offer` is the only insert path for `assignments`. It sets the application to `accepted` and inserts one `confirmed` assignment with both confirmation timestamps (the offer is the employer confirmation; accept is the worker confirmation). The write is audited as `application.accept` and `assignment.create`. Audits do not store the private address, the note, or credential numbers.

The employer screen publishes with Phase 3 `public.transition_job`. A verified organization becomes `published`. Any other verification status becomes `pending_review` and stays off the public list. `public.publish_job` still performs that same transition. Publish uses Phase 3’s completeness check (title, a description of at least 20 characters, a public city, pay, headcount, and a start and end for a single shift). `save_job_draft` still refuses edits once a shift has left draft or pending review (`job is locked`). The employer form updates job columns directly under `app.guard_job_write`.

Pay copy states that the named organization sets the wage and employs the worker. The marketplace does not. There is no criminal-history field.

## Search performance

Indexes added in `20261026120000_job_marketplace.sql`: `jobs_published_sort_idx`, `jobs_published_approx_idx`, `jobs_published_city_idx`, `jobs_published_county_idx`, `jobs_published_shift_idx`. The Phase 0 index on private `site_lat` / `site_lng` is unchanged and is not the public search key.

`EXPLAIN` against about 2,000 rolled-back published rows (then `ROLLBACK`, so they are not left in the database):

- A selective approximate bounding box uses `Bitmap Index Scan on jobs_published_approx_idx`.
- The default sort uses `Index Scan using jobs_published_sort_idx` with a `Limit`.
- `select * from search_jobs(...)` shows `Function Scan on search_jobs`. The SQL function is not inlined because it pins `search_path` (required for the security-definer checks). The function body is the same predicate as the bbox plan.

The plan is in the test run’s `search-explain.txt` artifact. The 2,000 rows were generated inside a transaction and rolled back.

## Checks run locally

| Check | Result |
|---|---|
| `npx supabase db reset --yes` | `0000`–`0004`, `20261026065707_employer_portal.sql`, `20261026072821_column_privileges.sql`, `20261026120000_job_marketplace.sql`, and `supabase/seed.sql` applied |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm test` | 57 passed |
| `npm run test:rls` | 87 passed (Phase 1: 48, Phase 2: 17, Phase 3: 14, Phase 4: 8). None skipped. |
| `npm run test:e2e` | 8 passed, viewport 390×844, including the Phase 3 employer portal and search → detail (no street address) → blocked apply → verified credential → apply → employer shortlist → offer → worker accept (address visible) → signed-out visitor still sees no street address |

`supabase/seed.sql` is still a no-op. Place centroids are reference rows in the migration, not fake users or jobs.

Phase 4 RLS coverage: a worker cannot read another worker’s application or set an employer status; an employer sees applications only for their own organization’s jobs; anon reads published public columns only and cannot select private site columns or call `job_private_site`; withdrawn and rejected rows cannot move backward; assignment insert is rejected except through `accept_offer`.

## RLS count

The first Phase 4 run reported 73 passed. That was Phase 1 (48, including four `it.each` cases), Phase 2 (17), and Phase 4 (8). No Phase 1 or Phase 2 case was removed, skipped, or merged. Phase 3’s 14 cases in `tests/rls/phase3.rls.test.ts` were not on this branch: it was cut from the Phase 2 commit before Phase 3 merged to `main`. The full suite now runs all four files: 48 + 17 + 14 + 8 = 87. The Phase 2 employer-profile case is the Phase 3 version, which reads `worker_search_cards` instead of `worker_profiles`.

## Database

Phase 3 migrations `20261026065707_employer_portal.sql` and `20261026072821_column_privileges.sql` are on this branch unchanged. Marketplace SQL is `supabase/migrations/20261026120000_job_marketplace.sql`, which runs after them. No tables or columns were dropped. RLS stays forced. Applicant access is folded into the existing `jobs_auth_read` and `jr_read` policies, so Phase 3’s one-authenticated-SELECT-policy check still holds. `app.worker_has_job_access` is a `search_path`-pinned definer so a job policy does not read `applications` under RLS and recurse. Client `INSERT` on `applications` was removed. `saved_jobs` inserts require the worker id and a published shift. Street addresses are written to `job_private_locations`. `app.guard_job_write` keeps Phase 3’s status machine and adds the public approximate point.

## Known issues

- No geocoding provider. Cities and ZIPs missing from `place_centroids` have no radius until the employer enters an approximate point.
- Public coordinates are shared by every site that rounds into the same 0.01-degree cell.
- A withdrawn or rejected application cannot be submitted again for that shift.
- Shift rows do not automatically become `filled` or `expired`; apply and accept enforce those blocks.
- An unverified organization still cannot put a shift on the public list. Publish stores `pending_review` until staff verify the organization at `/admin/organizations` and an org member publishes again.
- Authenticated members can still read sensitive organization columns (`stripe_customer_id`, license, contact). Anon is limited to public columns. That authenticated grant is unchanged from earlier phases.
- `search_jobs` does not inline, so `EXPLAIN` of the function call does not show the inner index plan.
- No email, SMS, payments, or background checks.
- Recurrence rules are stored and not expanded.

## Recommended next actions

- More California ZIP centroids, or a geocoder that writes only the rounded public point.
- Notify workers in the product UI (the in-app rows already exist) and, later, real delivery.
- Assignment lifecycle after `confirmed`: check-in, completion, and disputes.
- A re-apply path that does not delete the audit history.
