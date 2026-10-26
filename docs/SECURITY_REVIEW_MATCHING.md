# Matching security review

Reviewed with `20261026160000_matching.sql` applied on the local stack. Eligibility is a SQL predicate. Grok is a ranker of that set, and only when the server holds `XAI_API_KEY`.

## Eligibility cannot be widened by the model

`app.match_fact` returns null unless the hard checks in `docs/PHASE6.md` all pass. The two read RPCs call that function. `record_match_run` builds its own map from the same functions and ignores any ordered id that is not in the map. A reason code is kept only when `app.match_supported_codes` says the stored fact supports it. If the caller sends no supported code, the server uses the full supported set. The explanation text is produced in SQL from those codes. Free-text fields on the model payload are ignored by the Zod schema, and a schema failure rejects the whole reply.

The TypeScript parser refuses a fact that is missing a verified guard card, a verified organization, mandatory credentials, or the PPO product check. Those flags are set only after SQL has already filtered. The orchestrator also refuses to send a candidate object that contains a forbidden key.

Unknown ids, duplicate ids, and invented reason codes do not become suggestions. Tests cover an invented license string and a credential number that must not appear in the stored explanation, the audit row, or `ai_tool_calls`.

## No automatic rejection or offer

Nothing in this phase updates `applications` or `assignments`. The worker page links to the existing apply flow. The employer page can open the existing message action. It has no offer or reject control. Copy on both pages says the list is a suggestion.

## Data sent to Grok

The only object sent as the user message is `{ candidates: [...] }` where each candidate has exactly these keys:

| Field | Meaning |
|---|---|
| id | Job id or worker id, depending on direction |
| distance_miles | Miles between approximate points |
| radius_miles | Worker’s work radius |
| years_experience | Profile years, or null |
| min_years_experience | Job minimum, or null |
| category_match | Job category is in the worker’s preferred categories |
| pay_type | Job pay type |
| pay_min_cents | Job minimum pay in cents, or null |
| pay_meets_minimum | True when pay is hourly (the below-minimum pairs were already removed) |
| urgency | normal, priority, or urgent |
| shift_period | day, swing, night, or null |
| is_armed | Job flag |
| vehicle_required | Job flag |
| has_transportation | Profile flag, or null |
| availability_kind | `covers_shift` or `open_schedule` |
| guard_card_active | Always true in a fact that survived the filter |
| firearm_permit_active | Verified unexpired exposed firearm permit |
| ep_training_active | Verified unexpired EP training |
| off_duty_le_approved | `approval_documented` and unexpired on the shift date |
| ppo_requirement_met | Unarmed verified org, or armed verified PPO / branch / proprietary security employer |
| mandatory_credentials_met | Always true in a fact that survived the filter |

Not sent: display name, headline, bio, email, phone, postal code, city name, street address, latitude, longitude, credential number, document path, languages, skills, law-enforcement narrative, agency name, and any protected-class or conviction field. `FORBIDDEN_PROMPT_KEYS` in `src/lib/matching/constants.ts` is the denylist the orchestrator walks before the call. There is no conviction-history column.

California Fair Chance Act and FEHA automated-decision context: this feature does not receive or infer conviction history, and it does not reject a worker. It orders people and shifts that already meet published credential, distance, availability, and pay checks. A missing xAI key does not change who is eligible.

## Key handling

`XAI_API_KEY` and `XAI_MODEL_MATCHING` are read only in `src/server/matching/grok.ts`. The key is an `Authorization` header. It is not returned, logged, or copied into `ai_tool_calls`. The client bundle does not reference it. An empty key, `MATCHING_DISABLE_GROK=1`, a non-OK response, a timeout (12 seconds), or unparseable content falls back to the fixed score. Tests do not call the live API.

`record_match_run` is executed with the service-role client after the user-scoped read. Grok does not receive that client. The function rejects any JWT whose role claim is present and is not `service_role`. Execute is granted only to `service_role`.

## Who can read suggestions

`match_runs` and `match_suggestions` have RLS enabled and forced. Authenticated select is limited to the requester, the worker on a worker-direction run, a member of the organization on an employer-direction run, or staff. Anon has no select and no RPC execute. There is no insert, update, or delete grant for `anon` or `authenticated`.

`eligible_workers_for_job` raises `42501` unless the caller is a member of that job’s organization. The worker list is built with `is_searchable = true`. `eligible_shifts_for_me` is the signed-in worker only. A hidden worker still receives their own eligible shifts. They do not appear on an employer list.

The read RPCs return the fact JSON so the server can rank without a second query. That JSON includes the job title, organization name, worker display name, headline, city, county, and verified credential type code, name, and expiry date. It does not include credential numbers, document paths, the private site address, precise coordinates, languages, or skills. The employer page does not render that RPC payload. It renders `worker_search_cards` (the same columns as before) plus the server-built explanation and checklist. A suggestion whose worker is no longer on the search card is omitted.

Column grants on `jobs` gained `requires_off_duty_le` for select, insert, and update. Private site columns stay revoked. No existing grant was widened to credential numbers or message bodies.

## Audit contents

`match.run` stores field names and counts, not the candidate objects and not credential numbers. Grok tool-call arguments are the same field-name list plus eligible count and direction. Token counts are stored when the provider returns non-negative numbers.

## Realtime file

`supabase/realtime_authorization.sql` no longer runs `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY`. Hosted Supabase already enables it, and the statement fails with `42501` unless the runner owns the table. `npm run db:reset` still applies the two conversation policies as `supabase_admin`. Local `realtime.messages` already has RLS on, so the policies attach.

## What is still weak

- The read RPCs return a broader fact than the page renders, including credential type and expiry. Callers who can already refresh suggestions can see that JSON in the network response.
- Distance uses city or ZIP centroids rounded to two decimals, or the profile approximate point. It is not a street-level check.
- The scan cap is 200 facts and the stored cap is 40. A worker with more than 200 eligible shifts does not see the rest.
- Rate limits are per actor inside `record_match_run` (20 per hour, 80 per 24 hours). They are not a global token budget. A configured key can still be called once per successful refresh under that cap.
- A direct database session whose JWT role claim is null can execute `record_match_run` if it can call the function. The grant is `service_role` only.
- Off-duty approval and PPO organization type are product filters. They are not a legal conclusion that a person or company may perform the work.
- This phase does not scan suggestion text for protected-class inferences beyond the closed reason-code list. The model is not given a channel to add prose.
