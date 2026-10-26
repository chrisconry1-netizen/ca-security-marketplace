# Proposed repository structure (pnpm + Turborepo monorepo)

```
security-marketplace/
├─ apps/
│  ├─ web/                         # Next.js 15 App Router (TypeScript, Tailwind)
│  │  ├─ src/app/
│  │  │  ├─ (marketing)/           # landing, pricing, legal pages
│  │  │  ├─ (auth)/                # login, register, verify-email, reset-password, account-type
│  │  │  ├─ (worker)/              # shifts, saved, applications, assignments, messages, profile, credentials, availability
│  │  │  ├─ (employer)/            # org, jobs, applicants, worker-search, rosters, messages, billing
│  │  │  ├─ (admin)/               # verification queues, reports, users, orgs, jobs, audit, metrics
│  │  │  ├─ api/
│  │  │  │  ├─ v1/                 # versioned public API (AVA, future mobile)
│  │  │  │  ├─ webhooks/stripe/    # signature-verified, idempotent
│  │  │  │  ├─ ai/                 # assistant + matching endpoints
│  │  │  │  └─ health/
│  │  │  └─ middleware.ts          # session refresh + coarse redirects only
│  │  ├─ src/components/           # ui/ (shadcn), job-card, worker-card, chat/, forms/
│  │  ├─ src/server/
│  │  │  ├─ auth/                  # requireUser, requireRole, requireOrgRole, requireAAL2
│  │  │  ├─ services/              # domain services (jobs, applications, credentials, ...)
│  │  │  ├─ privileged/            # ONLY place service_role client may be imported (lint-enforced)
│  │  │  ├─ ai/                    # orchestrator, tools/, eligibility/, ranking/, prompts/
│  │  │  ├─ billing/               # stripe client, checkout, portal, entitlements
│  │  │  ├─ storage/               # signed-URL issuance, upload validation
│  │  │  └─ audit/                 # audit() helper
│  │  └─ tests/                    # unit + integration (Vitest), e2e (Playwright)
│  └─ worker/                      # background worker (pg-boss): notifications, expiry sweeps, AV scan
├─ packages/
│  ├─ core/                        # domain types, state machines, permissions matrix, zod schemas
│  ├─ db/                          # generated Supabase types, query helpers
│  ├─ ai-tools/                    # typed tool definitions shared by web + AVA API
│  ├─ email-templates/             # React Email templates (Resend)
│  └─ config/                      # eslint, tsconfig, tailwind presets
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/0000_initial_schema.sql
│  ├─ seed.sql                     # dev-only reference data (credential_types, plans) — no fake users in prod
│  └─ tests/                       # pgTAP RLS suites; phase0_rls_smoke.sql
├─ docs/                           # ARCHITECTURE, REPO_STRUCTURE, ENV_VARS, COMPLIANCE_REVIEW, ADRs/, runbooks/
├─ .github/workflows/              # ci.yml, deploy-staging.yml, deploy-prod.yml (manual approval)
├─ render.yaml                     # web + worker + cron Blueprint
└─ package.json / pnpm-workspace.yaml / turbo.json
```
