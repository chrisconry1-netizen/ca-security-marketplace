# Messaging security review

Reviewed with the Phase 5 migration applied on the local stack and `npm run test:rls` at 100 passed (87 existing tests plus 13 in `tests/rls/phase5.rls.test.ts`). Playwright then exchanged messages between two signed-in browser contexts at 390×844.

## Findings

### Block checks were a no-op under RLS — fixed

`user_blocks` allows a row to be read only when `blocker_id = auth.uid()`. An inline policy subquery therefore cannot see that the other person blocked the sender. Phase 5 checks blocks in `app.users_blocked` and `app.messaging_blocked`, both `security definer`. A block in either direction rejects a new thread and a send, and it denies broadcast and presence writes on that conversation channel. The existing thread stays readable so the people in it can report. Tests cover both directions and the channel write denial.

### A user cannot read, subscribe to, insert into, or edit another conversation

- Outsiders get zero rows from `conversations`, `conversation_members`, `messages`, and `message_attachments`.
- Outsiders cannot insert a message, a conversation, or themselves as a member. Inserts on conversations and membership are revoked. `open_conversation` is the membership path and refuses a caller who is neither the worker nor a current organization member.
- `realtime.authorize` for an outsider is false for broadcast, presence, and postgres changes, read and write. The same call for a member allows reads and allows broadcast and presence writes, and it denies postgres-changes writes. An outsider’s live private subscribe does not reach `SUBSCRIBED`. A member’s does.
- Anon `select count(*)` on `messages` returns 0 (Phase 1 asserts the count, so anon `SELECT` stays granted and RLS returns no rows). Anon insert, anon RPCs, and anon Realtime authorization fail.
- Clients cannot update or delete messages. The column grants and `app.guard_message_write` both refuse. A spoofed `sender_id`, `kind = system`, and `kind = voice` are rejected. `sender_id` on `send_message` is `auth.uid()`.
- A moderator’s select of message bodies returns no rows. Staff are not given a bypass.

### Removed members lose access

`conversation_members.left_at` is not in the client update grant. `app.is_conversation_member` requires `left_at is null`, including the storage policies. Adding an organization member inserts them into that organization’s threads. Deleting the membership sets `left_at`. The test reads a message and downloads an attachment as the new member, then shows both fail after removal. A removed member cannot send.

### Attachments

The bucket is private. The path is `{conversation_id}/{user_id}/{uuid}.ext`. Storage RLS allows a member to read and only the uploader’s folder to insert. The attachment trigger also requires a matching `storage.objects` row in `message-attachments` whose owner is the sender and whose metadata size and MIME type match the row. An outsider cannot read the object or the table row. A path that names someone else’s folder is rejected.

Signed URLs are created with the user client, expire in 300 seconds, and are issued only when the path starts with the conversation id. `service_role` is not used to sign message files.

### Reports do not take automatic action

Reporting a message or a conversation requires membership. The report is inserted as `open`. The trigger writes an audit row with the reason and not the details. It does not set `messages.is_flagged`. An outsider’s report of a message they cannot see fails.

### Inbox search does not cross users

`my_inbox` is `security definer` and returns rows only for the caller’s active membership. A search string that matches another person’s message returns nothing to the outsider. `conversation_member_cards` returns no rows to a non-member. Archive is `archived_at` on the caller’s membership row; the other person’s inbox is unchanged.

## Realtime authorization gap in plain `db reset`

`realtime.messages` is owned by `supabase_realtime_admin`. The migration role is not that owner and is not a superuser, so the migration cannot create policies there. `supabase/realtime_authorization.sql` is applied by `scripts/apply-realtime-policies.sh` as `supabase_admin`. `npm run db:reset` runs both. A bare `supabase db reset` leaves private channels unauthorized (fail closed: subscribe and broadcast do not succeed).

The apply script does not enable RLS on `realtime.messages`. Hosted Supabase already has it, and `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` fails with `42501` when the runner is not the owner. Local databases already have that RLS on, so creating the policies is enough.

Policies key off `realtime.topic()` and `extension`. They do not require `private = true`, because `realtime.authorize` probes omit that column and it defaults to false.

## What is still weak

- Attachment `scan_status` stays `pending`. There is no scanner. Members can open a file that has not been scanned.
- The original `size_bytes <= 26214400` check remains. The new check and the trigger cap writes at 10 MiB.
- A failed send after a successful upload can leave an object. Clients have no delete policy on that bucket.
- Message text is not filtered. The composer says not to ask about conviction history. A report is the moderation path.
- In-app notification rows are created. No email, SMS, or push row is written.

## Tests that lock this in

`tests/rls/phase5.rls.test.ts` asserts anon denial, outsider table and Realtime denial, member channel rights, sender spoofing, immutability, staff non-access, both block directions, membership sync and removal, outreach and conversation caps, report behavior, inbox isolation, archive, publication and replica identity, attachment ownership, and a live private subscribe. The earlier 87 RLS tests still pass, including Phase 1’s messaging and storage cases.
