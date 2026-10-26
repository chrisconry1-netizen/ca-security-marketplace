-- Realtime authorization for Phase 5. Apply as supabase_admin (the local
-- migration role does not own realtime.messages). Idempotent.
--
-- Topic shapes the browser uses:
--   conversation:<conversation uuid>  postgres changes, broadcast, presence
--   inbox:<user uuid>                 broadcast only, to refresh that user's inbox
--
-- Do not require private = true. realtime.authorize() inserts probe rows
-- without setting private, and the column defaults to false.

alter table realtime.messages enable row level security;

drop policy if exists conversation_realtime_select on realtime.messages;
create policy conversation_realtime_select on realtime.messages
  for select to authenticated
  using (
    topic = (select realtime.topic())
    and (
      (
        extension in ('broadcast', 'presence', 'postgres_changes')
        and split_part((select realtime.topic()), ':', 1) = 'conversation'
        and app.is_conversation_member(app.try_uuid(split_part((select realtime.topic()), ':', 2)))
      )
      or (
        extension = 'broadcast'
        and split_part((select realtime.topic()), ':', 1) = 'inbox'
        and app.try_uuid(split_part((select realtime.topic()), ':', 2)) = (select auth.uid())
      )
    )
  );

drop policy if exists conversation_realtime_insert on realtime.messages;
create policy conversation_realtime_insert on realtime.messages
  for insert to authenticated
  with check (
    topic = (select realtime.topic())
    and (
      (
        extension in ('broadcast', 'presence')
        and split_part((select realtime.topic()), ':', 1) = 'conversation'
        and app.is_conversation_member(app.try_uuid(split_part((select realtime.topic()), ':', 2)))
        and not app.messaging_blocked(app.try_uuid(split_part((select realtime.topic()), ':', 2)))
      )
      or (
        extension = 'broadcast'
        and split_part((select realtime.topic()), ':', 1) = 'inbox'
        and app.try_uuid(split_part((select realtime.topic()), ':', 2)) = (select auth.uid())
      )
    )
  );
