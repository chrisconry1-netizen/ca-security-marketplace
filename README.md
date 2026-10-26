# California Security Workforce Marketplace

Security shift + workforce marketplace (Next.js 15 App Router · TypeScript · Tailwind v4 · Supabase via `@supabase/ssr`).
Status: **Phase 4 — job & shift marketplace** (local only; nothing deployed). See `docs/PHASE4.md`.

## Requirements
- Node.js **22+** (supabase-js 2.118 requires it)
- Docker + Supabase CLI (local stack)

## Local development
```bash
npm install
npm run db:start            # local Supabase (applies supabase/migrations/*)
supabase status -o env      # copy API_URL / ANON_KEY / SERVICE_ROLE_KEY / DB_URL into .env.local (see .env.example)
npm run dev                 # http://localhost:3000   · emails: Mailpit http://127.0.0.1:54324
```
Use `localhost` (not `127.0.0.1`) in the browser: auth cookies are host-scoped and email links target `NEXT_PUBLIC_APP_URL`.

## Checks
| Command | What |
|---|---|
| `npm run lint` | ESLint (incl. rule: service_role client importable only from `src/server/**`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (roles, guards logic, redirect safety, validation) |
| `npm run test:rls` | RLS + storage policy suite against the **local** stack (refuses non-local URLs) |
| `npm run test:e2e` | Playwright, mobile viewport: auth, roles, worker profile, and the shift marketplace (needs `npm run build`) |
| `npm run build` | Production build |

## Layout
```
src/middleware.ts                 session refresh + coarse signed-out redirects only
src/lib/supabase/{server,middleware}.ts
src/lib/auth/{roles,redirect,validation}.ts   pure, unit-tested
src/server/auth/guards.ts         requireUser / requireArea / requireRole (server-side authorization)
src/server/audit/audit.ts         recordAuthEvent (RPC) + audit() (service_role)
src/server/privileged/            ONLY place the service_role client lives
src/server/storage/               avatar + credential document upload and signed URLs
src/app/(auth)/                   login, register, verify-email, forgot/reset password, account-type, server actions
src/app/auth/confirm/route.ts     email verification + recovery link handler (PKCE code / token_hash)
src/app/jobs                       public shift search and detail
src/app/(app)/worker/{profile,credentials,availability,shifts,saved,applications}
src/app/(app)/employer/{org,jobs} organization, shift drafts, applicants
src/app/(app)/admin/verification  moderator credential queue (full admin center is later)
supabase/migrations/              0000 schema · 0001 auth · 0002 storage · 0003 profiles/credentials · 0004 advisor · 0005 marketplace
tests/{unit,rls,e2e}
docs/                             ARCHITECTURE, ENV_VARS, COMPLIANCE_REVIEW, PHASE1, PHASE2, PHASE4
```
