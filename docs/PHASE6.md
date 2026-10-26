# Phase 6 — Grok matching suggestions

Workers see recommended shifts. Employers see suggested workers for one published job. Both lists are suggestions. Refreshing a list does not apply, offer, reject, message, or hire anyone.

Eligibility is decided in Postgres before any model call. Grok, when `XAI_API_KEY` is set, may only order that set and return reason codes. The server writes every sentence the page shows.

## Eligibility

`app.match_fact` returns a row only when every hard check passes. `public.eligible_shifts_for_me` and `public.eligible_workers_for_job` expose that set. `src/lib/matching/eligibility.ts` mirrors the same checks for unit tests. SQL remains the enforcement point.

A pair is eligible only when all of these hold:

- The worker account is active.
- The job is published, not past its end or application deadline, and not filled.
- The worker holds a verified CA guard registration that is unexpired on the shift date (`ca_guard_registration`).
- An armed post also needs a verified, unexpired exposed firearm permit (`ca_exposed_firearm_permit`).
- Executive protection and close protection also need verified, unexpired `ep_training`.
- `jobs.requires_off_duty_le` needs `le_officer_profiles.status = approval_documented` and an unexpired `secondary_approval_expires_on` on the shift date. That flag is a human record. It is not a determination that the officer may work the post.
- Armed posts need a verified organization of type `ppo`, `private_patrol_operator_branch`, or `proprietary_security_employer`. Unarmed posts need a verified organization of any type. This is a product filter, not a licensing determination.
- Every mandatory `job_requirements` credential is verified and unexpired on the shift date.
- Distance from the worker’s approximate point (profile coordinates, otherwise `place_centroids` for city or ZIP) to `jobs.approx_lat` / `jobs.approx_lng` is within `work_radius_miles`. `app.miles_between` does the math. Missing coordinates fail the pair.
- Availability covers the shift in `America/Los_Angeles`, including a weekly blackout. A post with no fixed window needs some declared availability.
- No block in either direction between the worker and a current member of the hiring organization.
- No application row exists yet for that pair.
- Hourly pay is not below `min_hourly_rate_cents` when the worker set one. Flat and estimated pay skip that comparison.
- Employer suggestions additionally require `worker_profiles.is_searchable`. A worker’s own recommended shifts do not.

The functions return at most 200 facts, nearest first. A stored run keeps at most 40.

## Ranking

`src/server/matching/run.ts` loads facts with the signed-in user’s client, parses them, and drops anything that is not a complete eligible fact. It ranks with the same weights as `app.match_score`: category match, closeness inside the radius, hourly pay meeting the worker minimum, years of experience, urgency, and transportation when the post asks for a vehicle.

If `XAI_API_KEY` is missing, `MATCHING_DISABLE_GROK=1`, the eligible set is empty, the provider errors, or the reply fails the schema, the page says the fixed score was used and names why. Playwright sets `MATCHING_DISABLE_GROK=1` so the suite never calls xAI.

When Grok runs, the request body contains only the allowlisted candidate fields. The model must return `{ "rankings": [{ "id", "reason_codes" }] }`. `validateGrokRankings` drops unknown ids, duplicate ids, and reason codes the facts do not support. A payload that is not the schema, or that names nobody eligible, is discarded. Ids the model omits stay in the list, after the model’s order, in deterministic order. The server then calls `record_match_run`, which recomputes eligibility and drops any id that is no longer eligible.

Explanations and the checklist come from `app.match_explanation` and `app.match_checklist`. Model prose is not stored.

## What the page shows

- `/worker/recommended` — “Recommended shifts”, a refresh button, the model name and version, plain-language reasons, and an eligibility checklist. Each shift links to the public job page. Applying is a separate action.
- `/employer/jobs/[id]/suggestions` — “Suggested workers” for organization members. Cards come from `worker_search_cards`, so a worker who is no longer opted into search disappears even if an older suggestion row remains. Message uses the existing conversation action. There is no offer or reject control on this page.
- The job form has “This post requires a recorded off-duty law-enforcement approval.”

## Limits, audit, and model record

`record_match_run` is `service_role` only. A signed-in user who calls it is rejected. Each run allows 20 refreshes per hour and 80 per 24 hours for that actor.

Every run inserts `match.run` into `audit_logs` with direction, model, model version, source (`grok` or `deterministic_fallback`), fallback reason, counts, and the prompt field names. The payload of facts is not copied into the audit row. A Grok run also inserts `ai_tool_calls` (`rank_eligible_matches`) with those field names, counts, model, and token totals. `required_confirmation` is false because the call does not change an application or an offer. `actor_type` is `ai_assistant` for Grok and `system` for the fixed score.

`match_runs` stores `model` and `model_version`. The fixed score is `deterministic` / `v1`. A Grok run stores the sanitized model id returned by the provider, or `XAI_MODEL_MATCHING` when that id matches `^[A-Za-z0-9_.:-]{1,80}$`.

## Fields sent to Grok

Only these keys, documented again in `docs/SECURITY_REVIEW_MATCHING.md`:

`id`, `distance_miles`, `radius_miles`, `years_experience`, `min_years_experience`, `category_match`, `pay_type`, `pay_min_cents`, `pay_meets_minimum`, `urgency`, `shift_period`, `is_armed`, `vehicle_required`, `has_transportation`, `availability_kind`, `guard_card_active`, `firearm_permit_active`, `ep_training_active`, `off_duty_le_approved`, `ppo_requirement_met`, `mandatory_credentials_met`.

Names, free text, languages, skills, credential numbers, documents, precise coordinates, postal codes, contact details, law-enforcement narratives, and any protected-class or conviction field are not in that list. There is no conviction-history column in this schema.

## Database

`supabase/migrations/20261026160000_matching.sql` is additive:

- `jobs.requires_off_duty_le boolean not null default false`, with select granted to anon and authenticated, and insert and update granted to authenticated.
- `match_runs` and `match_suggestions`, RLS enabled and forced, select-only column grants, no client insert.
- Helper functions in `app` and the three RPCs above.

`npm run db:reset` applies that migration and then `supabase/realtime_authorization.sql`. That file does not enable RLS on `realtime.messages`. Hosted Supabase already has it, and `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` fails with `42501` when the runner is not the owner. Local reset still creates `conversation_realtime_select` and `conversation_realtime_insert`.

## Checks run locally

| Check | Result |
|---|---|
| `npm run db:reset` | Applied `20261026160000_matching.sql`, then created `conversation_realtime_select` and `conversation_realtime_insert` without altering RLS on `realtime.messages` |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass. Routes include `/worker/recommended` and `/employer/jobs/[id]/suggestions` |
| `npm test` | 93 passed |
| `npm run test:rls` | 108 passed (the previous 100 plus 8 in `tests/rls/phase6.rls.test.ts`) |
| `npm run test:e2e` | 10 passed. The matching spec uses the 390×844 project viewport, refreshes both lists, and writes `matching-recommended.png` and `matching-suggestions.png` |

## Known issues

- The read RPCs return the fact JSON to the caller, which is wider than the card the page renders. See `docs/SECURITY_REVIEW_MATCHING.md`.
- Distance uses approximate centroids. A worker or city with no centroid is not suggested.
- At most 200 facts are considered and 40 are stored.
- There is no global token budget in this phase. The per-actor refresh cap is the limit.
- The messaging end-to-end spec once missed a realtime delivery inside 15 seconds while other specs were running. The same full suite passed on the next run.
- Live xAI is not called by the test suite. An empty `XAI_API_KEY` is the fallback the browser spec asserts.
