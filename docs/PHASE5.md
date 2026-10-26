# Phase 5 — Realtime in-app messaging

Workers and employers message each other inside GuardGig.ai. Delivery uses Supabase Realtime on private channels. Nothing in this phase sends email, SMS, or push, and nothing hides or deletes a message because it was reported.

## Who may start a conversation

`public.open_conversation` is the only client path that inserts `conversations` and `conversation_members`.

- **Application.** The worker on that application, or an organization member (`owner_admin`, `manager`, or `recruiter_dispatcher`) of the job’s organization, may open the thread. There is one thread per `application_id`. Calling it again returns the same id and does not spend a quota. If the caller omits the application but one exists between that worker and organization, the latest application thread is used instead of a second outreach thread.
- **Assignment.** With no application and an assignment in `pending_confirmation`, `confirmed`, `in_progress`, `completed`, or `disputed`, either party may open one direct thread (`origin = assignment`).
- **Outreach.** An organization member may open one thread to a worker whose `worker_profiles.is_searchable` is true. Workers cannot cold-message an organization. Caps are 5 outreach threads per user and per organization per 24 hours, inside a broader cap of 40 new conversations per user per 24 hours.
- **Organization side.** Every current organization member is a member of that organization’s threads. Joining the organization adds them and clears `left_at`. Leaving sets `left_at` and removes read, send, and attachment access. The worker participant is not removed by an organization membership change. `support` threads are not client-creatable.
- **Blocks.** A block in either direction prevents a new thread and prevents sends. Existing threads stay readable so either person can report. Suspended or deactivated accounts cannot open or send. A person cannot message themselves.

## What shipped

- Inbox at `/messages` (search and per-member archive) and a thread at `/messages/[id]`.
- Composer, up to 3 attachments (PDF, JPEG, PNG, WebP, 10 MB each) in the private `message-attachments` bucket, signed for 5 minutes with the user client.
- Shift cards store `messages.job_id`. The page renders only columns the user client can select. If the shift is not readable, the card says it isn’t available.
- Unread counts from messages newer than `conversation_members.last_read_at`. Read receipts are the other active members’ `last_read_at`. `mark_conversation_read` moves that timestamp only when a newer message from someone else exists.
- Typing is a private broadcast of `{ userId }` only. It is not stored.
- Block (two steps: open the control, then confirm), unblock, and report a message or the conversation. Reports stay `open`. `messages.is_flagged` is not set.
- Employer “Find workers” lists `worker_search_cards` and can start outreach. Application screens have a Message action. `/employer/messages` redirects to `/messages`.
- Voice is schema and types only: `voice_duration_ms` (1–300000) and `voice_codec` (`audio/webm`, `audio/mp4`, `audio/ogg`). Clients cannot insert `kind = voice`.

## Limits

Kept in `src/lib/messaging/limits.ts` and enforced in Postgres:

| Limit | Value |
|---|---|
| Body | 8,000 characters |
| Send rate | 30 / 60 seconds and 400 / 24 hours per sender |
| Attachments | 3 per message, each ≤ 10 MiB |
| New conversations | 40 / user / 24 hours |
| Outreach | 5 / user and 5 / organization / 24 hours |
| Search | 2–80 characters, caller’s threads only |

`send_message` is `security invoker`, so table RLS applies. Triggers still force `sender_id = auth.uid()`, reject `system` and `voice`, reject edits and deletes from clients, and apply the rate limits. Direct inserts remain possible for the Phase 1 tests; the trigger applies the same rules.

## Realtime

Tables `messages`, `conversation_members`, and `conversations` are in `supabase_realtime` with replica identity full.

Private channel topics:

- `conversation:<uuid>` — postgres changes, broadcast, presence. A member may read all three and write broadcast and presence. Postgres changes cannot be written by a client. A block denies the write.
- `inbox:<user uuid>` — broadcast only, and only for that user. The insert trigger sends `{ conversation_id }` (no body) and an in-app notification whose body is “Open Messages to read it.”

`realtime.authorize` probes insert `private = false`, so the policies do not require `private`. The policies live in `supabase/realtime_authorization.sql` because `realtime.messages` is owned by `supabase_realtime_admin` and the migration role cannot create them. `npm run db:reset` applies that file as `supabase_admin`. A plain `supabase db reset` leaves private channels unauthorized.

The browser sets the Realtime auth token from the cookie session before subscribing. An insert refreshes the thread from the server. The client does not render the realtime payload as the message.

## Checks run locally

| Check | Result |
|---|---|
| `npm run db:reset` | Applied `20261026143000_report_target_conversation.sql`, `20261026143100_messaging.sql`, and realtime policies |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm test` | 65 passed |
| `npm run test:rls` | 100 passed (the previous 87 plus 13 in `tests/rls/phase5.rls.test.ts`) |
| `npm run test:e2e` | 9 passed. The messaging spec uses two 390×844 contexts, waits until both threads report Live, and exchanges a message each way, a shift card, and a PNG without a manual reload |

## Known issues

- No malware scan. `scan_status` stays `pending`, and a member can still open the file.
- The original attachment column check still allows 25 MB. A new check and the trigger enforce 10 MB, which matches the bucket.
- If `send_message` fails after the upload, the storage object can remain. Clients cannot delete message attachments.
- Realtime authorization is outside the SQL migration. See `docs/SECURITY_REVIEW_MESSAGING.md`.
- Mute has a column and no screen. Voice has no send path.
- Message text is not scanned for conviction-history questions. The composer tells people not to ask.
- Staff do not receive a blanket read of message bodies.
- Cities, payments, email, SMS, and push are unchanged and out of scope. Inbox refresh uses Realtime, not `notification_deliveries`.
