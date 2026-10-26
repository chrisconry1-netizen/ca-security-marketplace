# GuardGig.ai

California security shift marketplace (Next.js 15 App Router · TypeScript · Tailwind v4 · Supabase via `@supabase/ssr`). The product name is GuardGig.ai (`guardgig.ai`).
Status: **Phase 6 — Grok matching suggestions** on top of the Phase 5 messaging and Phase 4 marketplace (local only; nothing deployed). See `docs/PHASE6.md`.

## Requirements
- Node.js **22+** (supabase-js 2.118 requires it)
- Docker + Supabase CLI (local stack)

## Local development
```bash
npm install
npm run db:start            # local Supabase (applies supabase/migrations/*)
npm run db:reset            # reset and apply Realtime channel policies (scripts/apply-realtime-policies.sh)
supabase status -o env      # copy API_URL / ANON_KEY / SERVICE_ROLE_KEY / DB_URL into .env.local (see .env.example)
npm run dev                 # http://localhost:3000   · emails: Mailpit http://127.0.0.1:54324
```
Use `localhost` (not `127.0.0.1`) in the browser: auth cookies are host-scoped and email links target `NEXT_PUBLIC_APP_URL`.

## Checks
| Command | What |
|---|---|
| `npm run lint` | ESLint (incl. rule: service_role client importable only from `src/server/**`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (roles, guards logic, redirect safety, validation, messaging limits, eligibility, Grok output) |
| `npm run test:rls` | RLS + storage + Realtime authorization suite against the **local** stack (refuses non-local URLs) |
| `npm run test:e2e` | Playwright, 390×844: auth, roles, worker profile, employer portal, the shift marketplace, messaging, and match suggestions (needs `npm run build`) |
| `npm run build` | Production build |

## Layout
```
src/middleware.ts                 session refresh + coarse signed-out redirects only
src/lib/supabase/{server,browser,middleware}.ts
src/lib/auth/{roles,redirect,validation}.ts   pure, unit-tested
src/lib/messaging/                limits, validation, error catalogue
src/lib/matching/                 eligibility mirror, score, Grok field allowlist, output schema
src/server/matching/              match run orchestration and the server-only xAI client
src/server/auth/guards.ts         requireUser / requireArea / requireRole (server-side authorization)
src/server/audit/audit.ts         recordAuthEvent (RPC) + audit() (service_role)
src/server/privileged/            ONLY place the service_role client lives
src/server/storage/               avatar, credential document, org logo, and message attachment upload and signed URLs
src/app/(auth)/                   login, register, verify-email, forgot/reset password, account-type, server actions
src/app/auth/confirm/route.ts     email verification + recovery link handler (PKCE code / token_hash)
src/app/jobs                       public shift search and detail
src/app/(app)/messages            inbox, thread, composer
src/app/(app)/worker/{profile,credentials,availability,shifts,saved,applications,recommended}
src/app/(app)/employer/           organization, team invites, jobs, applicants, find workers
src/app/(app)/admin/verification  moderator credential queue
src/app/(app)/admin/organizations moderator organization queue
supabase/migrations/              0000 schema · 0001 auth · 0002 storage · 0003 profiles/credentials · 0004 advisor · 20261026065707 employer portal · 20261026072821 column privileges · 20261026120000 marketplace · 20261026143000 report target · 20261026143100 messaging · 20261026160000 matching
supabase/realtime_authorization.sql   private-channel policies (applied by npm run db:reset)
tests/{unit,rls,e2e}
docs/                             ARCHITECTURE, ENV_VARS, COMPLIANCE_REVIEW, PHASE1–PHASE6, SECURITY_REVIEW_MESSAGING, SECURITY_REVIEW_MATCHING
```
