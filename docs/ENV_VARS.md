# Environment variables (names only — never commit values)

Scope: **P** = public (shipped to browser, `NEXT_PUBLIC_*`), **S** = server-only secret, **W** = worker. Store secrets in Render env groups / GitHub Actions secrets. `.env.local` is git-ignored; `.env.example` lists names only.

| Name | Scope | Purpose |
|---|---|---|
| NEXT_PUBLIC_APP_URL | P | Canonical app URL |
| APP_ENV | S,W | development / staging / production |
| NEXT_PUBLIC_SUPABASE_URL | P | Supabase project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | P | Supabase anon key (RLS-bound) |
| SUPABASE_SERVICE_ROLE_KEY | S,W | Privileged server key — `src/server/privileged` only |
| SUPABASE_JWT_SECRET | S | Verify JWTs server-side if needed |
| SUPABASE_PROJECT_REF | CI | CLI migrations |
| SUPABASE_ACCESS_TOKEN | CI | CLI auth for `supabase db push` |
| DATABASE_URL | W,CI | Direct Postgres for pg-boss / migrations |
| XAI_API_KEY | S | Grok API |
| XAI_MODEL_MATCHING | S | Model id for ranking |
| XAI_MODEL_ASSISTANT | S | Model id for assistant |
| AI_DAILY_TOKEN_BUDGET | S | Global AI cost guardrail |
| STRIPE_SECRET_KEY | S | Stripe API |
| STRIPE_WEBHOOK_SECRET | S | Webhook signature verification |
| NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | P | Stripe.js |
| RESEND_API_KEY | S,W | Transactional email |
| EMAIL_FROM_ADDRESS | S,W | Verified sender |
| TWILIO_ACCOUNT_SID | W | SMS (later) |
| TWILIO_AUTH_TOKEN | W | SMS (later) |
| TWILIO_MESSAGING_SERVICE_SID | W | A2P 10DLC messaging service |
| TWILIO_VERIFY_SERVICE_SID | S | Phone verification (later) |
| UPSTASH_REDIS_REST_URL | S | Rate limiting |
| UPSTASH_REDIS_REST_TOKEN | S | Rate limiting |
| SENTRY_DSN | S,W | Error tracking |
| NEXT_PUBLIC_SENTRY_DSN | P | Browser error tracking |
| SENTRY_AUTH_TOKEN | CI | Source map upload |
| NEXT_PUBLIC_POSTHOG_KEY | P | Product analytics |
| NEXT_PUBLIC_POSTHOG_HOST | P | Analytics host |
| GEOCODING_API_KEY | S | ZIP/address → approx lat/lng (provider TBD) |
| AVA_OAUTH_CLIENT_ID | S | AVA integration (Phase 14) |
| AVA_OAUTH_CLIENT_SECRET | S | AVA integration (Phase 14) |
| API_KEY_HASH_PEPPER | S | Pepper for hashing api_clients keys |
| CLAMAV_HOST | W | Attachment virus scanning |
| RENDER_API_KEY / RENDER_DEPLOY_HOOK_URL | CI | Deploy automation |
