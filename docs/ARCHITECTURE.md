# Architecture — California Security Workforce Marketplace (Phase 0, proposed)

Status: PROPOSED for owner review. No feature code exists. No external services were provisioned, and nothing here has been deployed.

North star: two transactions. "I need security work" → qualified matching shifts. "I need security staff" → qualified, available workers. Every component below serves those two flows.

## 1. Stack evaluation

| Layer | Spec choice | Decision |
|---|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind | Keep. Use Server Components plus Route Handlers/Server Actions so privileged logic stays on the server. |
| DB | Supabase Postgres | Keep. Add PostGIS when Phase 4 radius search needs it. Phase 0 stores approximate lat/lng with a bounding-box index. |
| Auth | Supabase Auth | Keep. Email+password, email verification, and password reset in Phase 1. MFA required for staff and org owner_admin. |
| Authorization | RLS + server checks | Keep. Use both layers; never rely on the frontend alone. |
| Realtime | Supabase Realtime | Keep. Use Postgres Changes on `messages` (RLS-filtered), plus Broadcast/Presence for typing indicators. |
| Storage | Supabase Storage | Keep. All buckets are private and accessed through signed URLs. |
| AI | xAI Grok API | Keep. Grok runs only behind a typed tool layer. |
| Payments | Stripe | Keep. Checkout, Customer Portal, and webhooks. No worker payouts. |
| Email / SMS | Resend / Twilio | Keep. SMS waits until A2P 10DLC registration is done. |
| Jobs/queue | (not specified) | **Add:** Postgres-backed job queue (`pg-boss`, or Supabase Queues/pgmq) run by a background worker. Handles notifications, credential-expiry sweeps, and attachment scanning. |
| Rate limiting | (not specified) | **Add:** Upstash Redis (or Postgres token bucket at low volume). |
| Errors/monitoring | (not specified) | **Add:** Sentry, plus uptime checks (Better Stack or similar). |
| Analytics | (not specified) | **Add:** PostHog (product events, no PII in properties) plus SQL marketplace metrics. |

## 2. Application architecture

```
Browser / mobile web (Next.js RSC + client components)
      │  HTTPS (Supabase JWT cookie via @supabase/ssr)
      ▼
Next.js web service ──────────────► Supabase (Postgres+RLS, Auth, Storage, Realtime)
  ├─ /app (UI)                         ▲
  ├─ /api/* route handlers ────────────┤ user-scoped client (anon key + user JWT) → RLS applies
  │    ├─ domain services              │ service client (service_role) → ONLY in /server/privileged/*
  │    ├─ AI orchestrator ─► xAI Grok  │
  │    ├─ Stripe webhooks ◄─ Stripe    │
  │    └─ /api/v1/ava/* ◄─ AVA (scoped API keys)
  └─ enqueue jobs ─► Background worker (pg-boss) ─► Resend / Twilio / expiry sweeps / AV scan
```

- **Modular monolith.** One Next.js codebase is organized by domain (`identity`, `workers`, `credentials`, `orgs`, `jobs`, `applications`, `assignments`, `messaging`, `notifications`, `ai`, `billing`, `trust`, `admin`, `ava`). A separate worker process shares `packages/core`. Microservices are not justified at this stage.
- **Two Supabase clients.** The user-scoped client is the default, and RLS is enforced on every query it makes. The service-role client may be imported only from `src/server/privileged/**`, and an ESLint rule enforces that. It is used for verification, assignments, billing, and audit writes. Every privileged write is preceded by an explicit authorization check and followed by an audit log entry.

## 3. Frontend
- Route groups: `(marketing)`, `(auth)`, `(worker)`, `(employer)`, `(admin)`. Middleware refreshes the session and does a coarse role redirect only. The real checks are server-side in layouts and handlers.
- Mobile-first UI built with Tailwind and shadcn/ui primitives, accessible to WCAG 2.2 AA. Bottom-tab nav for workers (Shifts, Saved, Messages, Assignments, Profile).
- Data: server components for reads, server actions/route handlers for mutations, Zod validation on every input, and TanStack Query only for realtime and client-heavy views such as chat.

## 4. Backend / API
- Route handlers under `/api/*`. Each one runs `requireUser()`, then `requireRole()` or `requireOrgRole()`, then Zod parse, then the service call, then the audit log.
- State machines for `job_status`, `application_status`, and `assignment_status` live in `packages/core/domain`. Transitions are allowed only through services, never through raw updates. RLS revokes UPDATE on these status columns.
- Idempotency keys on POSTs that create applications, assignments, or Checkout sessions.
- Public versioned API `/api/v1/*`, used by AVA and future mobile apps, with an OpenAPI spec.

## 5. Authentication
- Supabase Auth with email/password plus magic link (optional). Email verification is required before applying or posting. Phone verification (Twilio Verify) comes later.
- Staff accounts (moderator/admin/super_admin) are never self-assignable. They are set by super_admin through an audited admin action and require TOTP MFA (AAL2 checked in server guards).
- Sessions use httpOnly cookies via `@supabase/ssr`. Rotate on privilege change. Lock out after repeated failures (Supabase rate limits plus our own).

## 6. Authorization model
| Role | Scope | Stored in |
|---|---|---|
| worker | own data | `profiles.account_type='worker'` |
| employer | via org membership | `profiles.account_type='employer'` |
| organization_admin (owner_admin) / organization_manager / recruiter_dispatcher | per org | `organization_members.role` |
| moderator / admin / super_admin | platform | `profiles.platform_role` (column not client-writable) |

Permission matrix lives in `packages/core/authz/permissions.ts` (single source), mirrored by RLS.

## 7. RLS strategy
- RLS is **enabled and forced on every public table**. With no matching policy, access is denied.
- Helper functions live in the private `app` schema as `SECURITY DEFINER` with an empty `search_path`: `app.is_staff()`, `app.is_admin()`, `app.is_org_member(org, roles[])`, `app.is_conversation_member(conv)`. This avoids recursive policy evaluation.
- Column-level GRANTs stop users from writing privileged columns: `platform_role`, `status`, `credentials.status`, `organizations.verification_status`, application/assignment status.
- Sensitive cross-party reads (an employer viewing a worker's credentials or availability) happen **only through server APIs** that return minimized projections, such as "Guard Card: verified, exp 2027-03". Employers never read raw tables or documents.
- Tables with no client policies (service-role only): `stripe_events`, writes to `credential_verifications`, `assignments`, `admin_actions`, `audit_logs`.
- Testing: a pgTAP suite runs in CI against `supabase start`, impersonating each role (Phase 1). Phase 0 smoke tests are in `supabase/tests/phase0_rls_smoke.sql`.
- Rule: RLS is never weakened to fix an app bug. Fix the query or route it through an audited server path.

## 8. File storage
- Buckets are all **private**: `credential-documents`, `le-documents`, `message-attachments`, `avatars`, `org-logos`. Approved public logos may later be copied to a public `org-logos-public` bucket.
- Path convention is `{owner_uuid}/{uuid}.{ext}`. A storage.objects policy allows an owner to write only into their own folder.
- Reads by anyone other than the owner go through server-issued **signed URLs** after an authz check. TTL is 60s for credential/LE docs and 5 min for message attachments. Each issuance is audit-logged for credential and LE documents.
- Uploads are limited by MIME allowlist (pdf, jpg, png, heic, webp) and size (10 MB docs, 25 MB attachments). Files are re-encoded or stripped of EXIF and virus-scanned (ClamAV in the worker) before `scan_status='clean'` makes them viewable.
- Documents never go to Grok.

## 9. Realtime messaging
- Tables: `conversations`, `conversation_members`, `messages`, `message_attachments`, `user_blocks`.
- Clients subscribe to Postgres Changes on `messages` filtered by `conversation_id`, and Realtime applies RLS. Typing indicators and presence use Broadcast channels with private-channel authorization.
- Unread count comes from `last_read_at` vs `messages.created_at`. Read receipts come from members' `last_read_at`.
- Conversation creation is server-only. It requires a legitimate relationship: an application, an assignment, or employer outreach within plan entitlements. This blocks cold mass-messaging.
- Abuse controls: per-user send rate limit, link/phishing heuristics, blocking enforced in the RLS insert policy, and report-message flow.

## 10. Notifications
- Domain events (e.g. `application.submitted`) are written as `notifications` rows, and a job is enqueued. The worker resolves `notification_preferences` and quiet hours, then sends through Resend (email) or Twilio (SMS, later) and logs `notification_deliveries`.
- Urgent shift alerts are rate-limited per worker per day, and recipients come only from the deterministic eligibility filter.
- Bulk sends (>N recipients) require owner approval per policy. TCPA/CAN-SPAM consent is tracked (see COMPLIANCE_REVIEW).

## 11. AI architecture (Grok)
```
User request ─► Orchestrator ─► (1) intent + parameter extraction (Grok, tool-calling)
                              ─► (2) typed tool call  e.g. search_jobs({armed:true, radius_mi:40, min_pay_cents:4500, date:'2026-10-31'})
                                     └─ executes as the USER (RLS client) — Grok never gets service_role
                              ─► (3) DETERMINISTIC ELIGIBILITY FILTER (SQL/TS, no AI):
                                     mandatory verified credentials (not expired at shift time), armed ⇒ verified
                                     guard registration + exposed firearm permit, availability overlap,
                                     distance ≤ radius, pay ≥ minimum, job published, not blocked, LE rules surfaced for human review
                              ─► (4) Grok RANKS ONLY the eligible set; returns ids + reason codes
                              ─► (5) Server validates every reason code against DB facts; drops unsupported reasons
                              ─► UI: "92% MATCH • Available during shift • 17 mi • Required verified credentials present"
```
- Typed tools (Zod schemas, read-only by default): `search_jobs`, `get_job`, `search_workers`, `get_worker_profile`, `get_verified_credentials`, `get_worker_availability`, `get_job_requirements`, `get_applicants`, `get_assignments`. Draft tools (`draft_application`, `draft_message`) return text only. Consequential tools (`submit_application`, `send_message`) create a **pending action** that the user must confirm in the UI. Grok never executes them directly. The assistant has no tools for accept/reject/hire/admin.
- Grok cannot override eligibility. Ineligible candidates are never passed to the model.
- Match explanations are built from structured reason codes (`AVAILABLE`, `DISTANCE_MI`, `CRED_VERIFIED`, `EXPERIENCE_YEARS`), not free text. The score is computed deterministically. Grok only orders ties or near-ties and writes a one-line summary drawn from the facts.
- Prompt-injection defenses: user content and DB text are passed as delimited data, tool allowlist per role, output schema validation, no secrets in prompts, PII minimization (no license numbers, documents, or addresses).
- Every tool call is logged to `ai_tool_calls`, with tokens counted for cost dashboards. A per-user daily AI quota is tied to plan entitlements.

## 12. Stripe
- Plans live in the `plans` table, mapping `code` to `stripe_price_id` and `entitlements` JSON. Pricing is configurable without deploys.
- Checkout Session is created server-side for the org with `stripe_customer_id`. Customer Portal handles self-service.
- Webhook `/api/webhooks/stripe` verifies the signature, inserts into `stripe_events` (PK = event id, for idempotency), processes the event, and upserts `subscriptions`/`payments`.
- Entitlements are always read server-side from `subscriptions` + `plans`. Frontend state is never trusted.
- **No marketplace payouts or Connect** until classification, tax, insurance, and regulatory review is complete (spec, Phase 9).

## 13. Audit logging
- `audit_logs` is append-only, with a trigger that blocks UPDATE/DELETE. It records actor_type (user/admin/system/ai_assistant/ava_api/stripe_webhook), action, entity, before/after (redacted), IP, UA, and request_id.
- `admin_actions` records a reason and second-step `confirmed_at` for high-impact actions (suspend, verify, remove).
- Logged events: auth events, role changes, credential/LE verification, document URL issuance, application/assignment transitions, AI consequential actions, AVA calls, billing changes.

## 14. Moderation / trust & safety
- New-employer jobs enter `pending_review` until the org is verified. Verified orgs auto-publish with spam heuristics.
- `reports` queue with triage SLA, `user_blocks`, account flags/suspension via `profiles.status`, and `messages.is_flagged`.
- Reviews are created only for completed assignments by the parties involved. They start as `pending_moderation` and are never auto-published if flagged.
- No automatic rejection of workers. Automated systems may only flag for human review (spec rule).

## 15. Analytics
- PostHog events (ids only, no PII): signup, profile_completed, credential_submitted, job_posted, application_submitted, offer, assignment_confirmed, assignment_completed.
- Marketplace KPIs via SQL views/materialized views: fill rate, time-to-fill, applicants per job, verified worker supply by county/category, liquidity (eligible workers per published shift), MRR.

## 16. Deployment — recommendation: **Render** (with reasoning)
| Criterion | Vercel | Render |
|---|---|---|
| Next.js DX / edge / preview deploys | Best-in-class | Good (preview environments on paid plans) |
| Long-running background worker (pg-boss, AV scan, expiry sweeps) | Not supported natively (would need a 2nd provider or Vercel cron + queues) | Native Background Worker + Cron Jobs |
| Function timeouts (AI orchestration, webhooks) | Plan-dependent limits | Long-lived web service, no per-request function cap |
| Single vendor, single bill, IaC | Needs extra vendors | `render.yaml` Blueprint covers web + worker + cron |
| Existing account | Not connected | Render connector already available to this bot |

**Recommendation: Render.** Run a web service (Next.js `standalone`), a background worker, and cron jobs, defined in `render.yaml`, with Supabase as managed data. The web app is still portable to Vercel later if edge performance becomes a priority. The worker would stay on Render either way. Environments: `dev` (local `supabase start`), `staging` (separate Supabase project and Render services), `production`. Nothing gets provisioned without owner approval, since it involves paid plans.

CI is GitHub Actions: lint, typecheck, unit tests, pgTAP RLS tests on a local Supabase, build, then deploy to staging. Production deploys are manual and approval-gated. Migrations are applied with `supabase db push` and reviewed before production.

## 17. Backups & DR
- Supabase Pro daily backups plus **PITR add-on** for production (paid, needs owner approval). A weekly logical `pg_dump` goes to separate encrypted storage (e.g. S3/R2 with object lock). Storage buckets are synced weekly.
- Targets (proposed): RPO ≤ 15 min with PITR, RTO ≤ 4 h. Restore drill quarterly into staging.
- Migrations are forward-only, with a written rollback SQL for each migration. Destructive changes require approval.

## 18. Monitoring
Monitoring covers Sentry (web + worker), Render metrics and alerts, an uptime monitor on `/api/health` (checks DB + Auth), Supabase advisors (security/performance lints), and Stripe webhook failure alerts. A dashboard tracks queue depth, notification failure rate, AI tokens/cost per day, and 4xx/5xx rates. A weekly technical report runs after launch.

## 19. AVA integration strategy (Phase 14)
- AVA stays a **separate system** and talks to `/api/v1/ava/*` only. It has no DB access and no service key.
- Auth: OAuth 2.0 authorization-code + PKCE so the user consents to scopes (preferred). Fallback is per-user API keys stored hashed in `api_clients`.
- Scopes: `jobs:read`, `applications:read`, `notifications:read`, `messages:read`, `applications:draft`, `messages:draft`, `applications:submit_confirmed`.
- Consequential actions use a two-step flow. `POST /applications/intents` returns a summary and `intent_id`. AVA reads it to the user. `POST /applications/intents/{id}/confirm` is accepted only within a TTL, and the confirmation is audit-logged with actor_type `ava_api`.
- Rate limits per client and per user, and every call is audited. The same deterministic eligibility filter applies.
