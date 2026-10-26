# Phase 1 — Application Foundation & Authentication

## Role model
| Spec role | Source of truth |
|---|---|
| worker / employer | `profiles.account_type` (chosen once via `select_account_type` RPC; `staff` only settable by service_role) |
| organization_admin / organization_manager | `organization_members.role` = `owner_admin` / `manager` (`recruiter_dispatcher` → `organization_recruiter`) |
| moderator / admin / super_admin | `profiles.platform_role` (column not client-writable) |

Authorization layers: (1) middleware — signed-out redirect only; (2) server guards (`requireArea`, `requireRole`) on every protected page, using `auth.getUser()` (JWT validated by Supabase Auth) and RLS-bound profile reads; (3) Postgres RLS on every table + storage.objects. No role check is frontend-only.

## Migrations
- `0001_auth_foundation.sql` — profile auto-provisioning trigger (ignores role/type in signup metadata), email sync + email-verified audit trigger, one-time `select_account_type`, `my_roles()`, `record_auth_event()` (whitelist: auth.login/logout/password_updated, actor forced to `auth.uid()`, 30/min throttle), revokes client writes on `audit_logs`, replaces `worker_profiles`/`employer_profiles` "for all" owner policies with select/update (rows only created by RPC), column-restricts `employer_profiles` updates. Non-destructive (only `drop not null` on `profiles.account_type` and policy replacement).
- `0002_storage_buckets.sql` — 5 private buckets with size + MIME limits (no SVG), policies per path convention. Credential/LE docs: owner upload/read, no client update/delete (evidence preservation).

## Auth settings (supabase/config.toml, local)
Email confirmation required; min password 12 with lower/upper/digit; redirect allow-list `…/auth/confirm**`. **These must be mirrored in the hosted project's Auth settings** (dashboard) — not done; no remote changes in Phase 1.

## Deferred / known gaps
- Admin MFA (AAL2) enforcement — Phase 12 (needs enrollment UI). Admin area currently requires staff role only.
- App-level rate limiting (Upstash) — Supabase Auth's built-in limits only for now.
- Custom SMTP (Resend) for auth emails — hosted Supabase default mailer is rate-limited and not for production.
- Single Next.js app at repo root instead of the Phase 0 pnpm/Turborepo monorepo — deferred until a second app (worker/AVA API) exists.
- `npm audit`: postcss (high) via Next 15's bundled build-time postcss; fix requires Next 16 (major). Build-time only, no untrusted CSS processed; revisit before launch.
- `supabase/tests/local_supabase_stub.sql` / `phase0_rls_smoke.sql` are Phase 0 artifacts, superseded by `tests/rls`.
