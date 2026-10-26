-- =====================================================================
-- 20261026143100_messaging.sql — Phase 5 realtime messaging
-- Additive only. No tables or columns are dropped. RLS stays forced
-- on public tables. Client privileges on privileged columns get
-- tighter, not wider.
--
-- Who may open a thread (public.open_conversation is the only insert
-- path for conversations and membership rows):
--   * Application: the worker on that application, or an organization
--     member (owner_admin, manager, recruiter_dispatcher) of the job's
--     organization. One thread per application. A second call returns
--     the same id and does not spend a quota.
--   * If the caller does not pass an application but one exists between
--     that worker and organization, the latest application thread is
--     used instead of a new outreach thread.
--   * Assignment: if there is no application and there is an assignment,
--     either party may open one direct thread (origin 'assignment').
--   * Outreach: an organization member may open one thread to a worker
--     whose worker_profiles.is_searchable is true. Workers cannot cold-
--     message an organization. Caps: 5 outreach threads per user and
--     per organization per 24 hours.
--   * Every current organization member is a member of the organization's
--     threads. Joining the organization adds them. Leaving sets left_at
--     and removes access. support threads are not client-creatable.
--   * New threads also count toward 40 per user per 24 hours.
--
-- Sends (public.send_message and direct inserts) require an active
-- membership, sender_id = auth.uid(), and no block in either direction
-- between the sender and another active member. Limits, mirrored in
-- src/lib/messaging/limits.ts: 30 messages / 60 seconds, 400 / 24 hours,
-- body <= 8000 characters, 3 attachments, each <= 10 MiB (the bucket
-- limit). The older column check still allows 25 MiB; the new check
-- and the trigger enforce 10 MiB.
--
-- Voice columns are reserved. kind 'voice' is rejected for clients.
-- Typing is not stored. Realtime authorization is on realtime.messages.
-- Authorize probes insert private = false, so policies must not require
-- private is true. Topic shapes: conversation:<uuid> and inbox:<uid>.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------
alter table public.conversations
  add column worker_id uuid references public.profiles(id) on delete set null,
  add column origin text;

alter table public.conversations
  add constraint conversations_origin_chk
  check (origin is null or origin in ('application', 'assignment', 'outreach'));

comment on column public.conversations.worker_id is
  'The worker participant. Organization members are conversation_members, not this column.';
comment on column public.conversations.origin is
  'Why the thread exists: application, assignment, or searchable-worker outreach.';

alter table public.conversation_members
  add column left_at timestamptz;

comment on column public.conversation_members.left_at is
  'Set when the user loses access. Clients cannot update this column.';

alter table public.messages
  add column voice_duration_ms integer,
  add column voice_codec text;

alter table public.messages
  add constraint messages_voice_reserved check (
    (
      kind <> 'voice'::public.message_kind
      and voice_duration_ms is null
      and voice_codec is null
    )
    or (
      kind = 'voice'::public.message_kind
      and voice_duration_ms between 1 and 300000
      and voice_codec in ('audio/webm', 'audio/mp4', 'audio/ogg')
    )
  );

comment on column public.messages.voice_duration_ms is
  'Reserved for a future voice phase. Clients cannot set it, and kind voice is rejected.';
comment on column public.messages.voice_codec is
  'Reserved codec (audio/webm, audio/mp4, audio/ogg). No voice send path exists.';

alter table public.message_attachments
  add constraint message_attachments_bucket_size check (size_bytes <= 10485760),
  add constraint message_attachments_mime_chk check (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  add constraint message_attachments_path_chk check (
    storage_path ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$'
    and split_part(storage_path, '/', 1) = conversation_id::text
  );

create index conversations_worker_id_idx on public.conversations (worker_id);
create index conversations_created_by_created_at_idx on public.conversations (created_by, created_at desc);
create index conversations_outreach_created_idx
  on public.conversations (organization_id, created_at desc)
  where origin = 'outreach';
create unique index conversations_one_application_idx
  on public.conversations (application_id)
  where application_id is not null;
create unique index conversations_one_pair_idx
  on public.conversations (organization_id, worker_id)
  where application_id is null and worker_id is not null;
create index messages_sender_created_at_idx on public.messages (sender_id, created_at desc);

-- ---------------------------------------------------------------------
-- Helpers (private schema). Block checks must be definer: user_blocks
-- RLS only lets the blocker read the row, so an inline policy subquery
-- cannot see that someone else blocked the sender.
-- ---------------------------------------------------------------------
create or replace function app.is_conversation_member(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conv
      and cm.user_id = (select auth.uid())
      and cm.left_at is null
  )
$$;

create or replace function app.users_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is not null
    and p_b is not null
    and p_a <> p_b
    and exists (
      select 1
      from public.user_blocks b
      where (b.blocker_id = p_a and b.blocked_id = p_b)
         or (b.blocker_id = p_b and b.blocked_id = p_a)
    )
$$;

create or replace function app.messaging_blocked(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members o
    join public.user_blocks b
      on (
        (b.blocker_id = o.user_id and b.blocked_id = (select auth.uid()))
        or (b.blocker_id = (select auth.uid()) and b.blocked_id = o.user_id)
      )
    where o.conversation_id = p_conversation
      and o.user_id <> (select auth.uid())
      and o.left_at is null
  )
$$;

create or replace function app.job_shareable(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = p_job
      and (
        j.status = 'published'
        or app.is_org_member(j.organization_id)
        or exists (
          select 1
          from public.applications a
          where a.job_id = j.id
            and a.worker_id = (select auth.uid())
        )
      )
  )
$$;

create or replace function app.assert_conversation_quota(p_user uuid, p_org uuid, p_outreach boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day integer;
  v_user_outreach integer;
  v_org_outreach integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('conv:' || p_user::text, 0));
  select count(*)::int into v_day
  from public.conversations
  where created_by = p_user
    and created_at > pg_catalog.now() - interval '24 hours';
  if v_day >= 40 then
    raise exception 'conversation rate limit' using errcode = 'P0001';
  end if;
  if p_outreach then
    select count(*)::int into v_user_outreach
    from public.conversations
    where created_by = p_user
      and origin = 'outreach'
      and created_at > pg_catalog.now() - interval '24 hours';
    if v_user_outreach >= 5 then
      raise exception 'outreach rate limit' using errcode = 'P0001';
    end if;
    select count(*)::int into v_org_outreach
    from public.conversations
    where organization_id = p_org
      and origin = 'outreach'
      and created_at > pg_catalog.now() - interval '24 hours';
    if v_org_outreach >= 5 then
      raise exception 'outreach rate limit' using errcode = 'P0001';
    end if;
  end if;
end
$$;

revoke all on function app.users_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function app.messaging_blocked(uuid) from public, anon, authenticated;
revoke all on function app.job_shareable(uuid) from public, anon, authenticated;
revoke all on function app.assert_conversation_quota(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function app.messaging_blocked(uuid) to authenticated, service_role;
grant execute on function app.job_shareable(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Membership changes. Organization membership is the source of truth
-- for the org side of a thread. The worker participant is not removed
-- when an organization row changes.
-- ---------------------------------------------------------------------
create or replace function app.sync_org_conversation_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id
    from public.conversations c
    where c.organization_id = new.organization_id
      and c.worker_id is distinct from new.user_id
    on conflict (conversation_id, user_id) do update
      set left_at = null
      where public.conversation_members.left_at is not null;
    return new;
  end if;

  update public.conversation_members cm
     set left_at = pg_catalog.now()
    from public.conversations c
   where c.id = cm.conversation_id
     and c.organization_id = old.organization_id
     and cm.user_id = old.user_id
     and cm.user_id is distinct from c.worker_id
     and cm.left_at is null;
  return old;
end
$$;

drop trigger if exists organization_members_sync_conversations on public.organization_members;
create trigger organization_members_sync_conversations
  after insert or delete on public.organization_members
  for each row execute function app.sync_org_conversation_member();

create or replace function app.guard_member_self_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.conversation_id is distinct from old.conversation_id
     or new.user_id is distinct from old.user_id
     or new.joined_at is distinct from old.joined_at
     or new.left_at is distinct from old.left_at then
    raise exception 'membership is immutable' using errcode = '42501';
  end if;
  if old.left_at is not null then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if new.last_read_at is not null and new.last_read_at > pg_catalog.now() + interval '1 minute' then
    new.last_read_at := pg_catalog.now();
  end if;
  if new.archived_at is not null and new.archived_at > pg_catalog.now() + interval '1 minute' then
    new.archived_at := pg_catalog.now();
  end if;
  return new;
end
$$;

drop trigger if exists conversation_members_guard_self_update on public.conversation_members;
create trigger conversation_members_guard_self_update
  before update on public.conversation_members
  for each row execute function app.guard_member_self_update();

-- ---------------------------------------------------------------------
-- Message and attachment guards.
-- ---------------------------------------------------------------------
create or replace function app.guard_message_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
  v_day integer;
begin
  if tg_op <> 'INSERT' then
    if auth.uid() is null and current_user in ('postgres', 'supabase_admin', 'service_role') then
      return coalesce(new, old);
    end if;
    raise exception 'messages are immutable' using errcode = '42501';
  end if;

  if auth.uid() is null then
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      return new;
    end if;
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if new.sender_id is distinct from auth.uid() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if new.kind not in ('text', 'job_card', 'attachment') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if new.is_flagged or new.edited_at is not null or new.deleted_at is not null
     or new.voice_duration_ms is not null or new.voice_codec is not null then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not app.is_conversation_member(new.conversation_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if app.messaging_blocked(new.conversation_id) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status <> 'active'
  ) then
    raise exception 'account not active' using errcode = '42501';
  end if;
  if new.body is not null and pg_catalog.char_length(new.body) > 8000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if new.kind = 'text' and nullif(pg_catalog.btrim(coalesce(new.body, '')), '') is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if new.kind = 'job_card' then
    if new.job_id is null then
      raise exception 'invalid input' using errcode = '22023';
    end if;
    if not app.job_shareable(new.job_id) then
      raise exception 'job not shareable' using errcode = '42501';
    end if;
  elsif new.job_id is not null then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('msg:' || auth.uid()::text, 0));
  select count(*)::int into v_recent
  from public.messages
  where sender_id = auth.uid()
    and created_at > pg_catalog.now() - interval '60 seconds';
  if v_recent >= 30 then
    raise exception 'message rate limit' using errcode = 'P0001';
  end if;
  select count(*)::int into v_day
  from public.messages
  where sender_id = auth.uid()
    and created_at > pg_catalog.now() - interval '24 hours';
  if v_day >= 400 then
    raise exception 'message rate limit' using errcode = 'P0001';
  end if;
  return new;
end
$$;

drop trigger if exists messages_guard_write on public.messages;
create trigger messages_guard_write
  before insert or update or delete on public.messages
  for each row execute function app.guard_message_write();

create or replace function app.after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  update public.conversations
     set last_message_at = coalesce(new.created_at, pg_catalog.now())
   where id = new.conversation_id;

  if auth.uid() is null then
    return new;
  end if;

  for v_member in
    select cm.user_id
    from public.conversation_members cm
    where cm.conversation_id = new.conversation_id
      and cm.left_at is null
      and cm.user_id is distinct from new.sender_id
  loop
    perform app.notify_user(
      v_member,
      'new_message',
      'New message',
      'Open Messages to read it.',
      '/messages/' || new.conversation_id::text,
      pg_catalog.jsonb_build_object('conversation_id', new.conversation_id)
    );
    perform realtime.send(
      pg_catalog.jsonb_build_object('conversation_id', new.conversation_id),
      'message',
      'inbox:' || v_member::text,
      true
    );
  end loop;
  perform set_config('realtime.topic', '', true);
  return new;
end
$$;

drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert
  after insert on public.messages
  for each row execute function app.after_message_insert();

create or replace function app.guard_attachment_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
  v_owner uuid;
  v_owner_id text;
  v_size bigint;
begin
  if tg_op <> 'INSERT' then
    if auth.uid() is null and current_user in ('postgres', 'supabase_admin', 'service_role') then
      return coalesce(new, old);
    end if;
    raise exception 'messages are immutable' using errcode = '42501';
  end if;

  if auth.uid() is null then
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      return new;
    end if;
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if new.scan_status is distinct from 'pending' then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not app.is_conversation_member(new.conversation_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if app.messaging_blocked(new.conversation_id) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  if split_part(new.storage_path, '/', 1) is distinct from new.conversation_id::text
     or split_part(new.storage_path, '/', 2) is distinct from auth.uid()::text then
    raise exception 'attachment invalid' using errcode = '42501';
  end if;
  if new.size_bytes is null or new.size_bytes < 1 or new.size_bytes > 10485760 then
    raise exception 'attachment invalid' using errcode = '42501';
  end if;
  if new.mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    raise exception 'attachment invalid' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.messages m
    where m.id = new.message_id
      and m.conversation_id = new.conversation_id
      and m.sender_id = auth.uid()
      and m.kind = 'attachment'
      and m.created_at > pg_catalog.now() - interval '10 minutes'
  ) then
    raise exception 'attachment invalid' using errcode = '42501';
  end if;
  if (
    select count(*)::int from public.message_attachments a where a.message_id = new.message_id
  ) >= 3 then
    raise exception 'attachment invalid' using errcode = '42501';
  end if;

  select o.metadata, o.owner, o.owner_id
    into v_meta, v_owner, v_owner_id
  from storage.objects o
  where o.bucket_id = 'message-attachments'
    and o.name = new.storage_path
  limit 1;
  if v_meta is null and v_owner is null and v_owner_id is null then
    raise exception 'attachment invalid' using errcode = '42501';
  end if;
  if v_owner is distinct from auth.uid() and v_owner_id is distinct from auth.uid()::text then
    raise exception 'attachment invalid' using errcode = '42501';
  end if;
  v_size := coalesce((v_meta->>'size')::bigint, -1);
  if v_size is distinct from new.size_bytes then
    raise exception 'attachment invalid' using errcode = '42501';
  end if;
  if coalesce(v_meta->>'mimetype', '') is distinct from new.mime_type then
    raise exception 'attachment invalid' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists message_attachments_guard_write on public.message_attachments;
create trigger message_attachments_guard_write
  before insert or update or delete on public.message_attachments
  for each row execute function app.guard_attachment_write();

create or replace function app.guard_report_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if new.reporter_id is distinct from auth.uid() or new.status is distinct from 'open' then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if new.target_type = 'message' then
    select m.conversation_id into v_conversation
    from public.messages m
    where m.id = new.target_id;
    if v_conversation is null or not app.is_conversation_member(v_conversation) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  elsif new.target_type::text = 'conversation' then
    if not app.is_conversation_member(new.target_id) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  end if;
  perform app.write_audit(
    'user',
    auth.uid(),
    null,
    'report.create',
    new.target_type::text,
    new.target_id,
    null,
    pg_catalog.jsonb_build_object('reason', new.reason),
    null,
    null,
    null
  );
  return new;
end
$$;

drop trigger if exists reports_guard_message_target on public.reports;
create trigger reports_guard_message_target
  before insert on public.reports
  for each row execute function app.guard_report_write();

create or replace function app.audit_user_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  perform app.write_audit(
    'user',
    auth.uid(),
    null,
    case when tg_op = 'DELETE' then 'user.unblock' else 'user.block' end,
    'user_block',
    case when tg_op = 'DELETE' then old.blocked_id else new.blocked_id end,
    null,
    pg_catalog.jsonb_build_object(
      'blocked_id', case when tg_op = 'DELETE' then old.blocked_id else new.blocked_id end
    ),
    null,
    null,
    null
  );
  return coalesce(new, old);
end
$$;

drop trigger if exists user_blocks_audit on public.user_blocks;
create trigger user_blocks_audit
  after insert or delete on public.user_blocks
  for each row execute function app.audit_user_block();

revoke all on function app.sync_org_conversation_member() from public, anon, authenticated;
revoke all on function app.guard_member_self_update() from public, anon, authenticated;
revoke all on function app.guard_message_write() from public, anon, authenticated;
revoke all on function app.after_message_insert() from public, anon, authenticated;
revoke all on function app.guard_attachment_write() from public, anon, authenticated;
revoke all on function app.guard_report_write() from public, anon, authenticated;
revoke all on function app.audit_user_block() from public, anon, authenticated;
grant execute on function app.sync_org_conversation_member() to authenticated, service_role;
grant execute on function app.guard_member_self_update() to authenticated, service_role;
grant execute on function app.guard_message_write() to authenticated, service_role;
grant execute on function app.after_message_insert() to authenticated, service_role;
grant execute on function app.guard_attachment_write() to authenticated, service_role;
grant execute on function app.guard_report_write() to authenticated, service_role;
grant execute on function app.audit_user_block() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Policies. One select and one insert on messages. Update stays closed.
-- ---------------------------------------------------------------------
drop policy if exists cm_self_update on public.conversation_members;
create policy cm_self_update on public.conversation_members
  for update to authenticated
  using (user_id = (select auth.uid()) and left_at is null)
  with check (user_id = (select auth.uid()) and left_at is null);

drop policy if exists msg_member_insert on public.messages;
create policy msg_member_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and kind in ('text', 'job_card', 'attachment')
    and app.is_conversation_member(conversation_id)
    and not app.messaging_blocked(conversation_id)
  );

drop policy if exists ma_member_insert on public.message_attachments;
create policy ma_member_insert on public.message_attachments
  for insert to authenticated
  with check (
    app.is_conversation_member(conversation_id)
    and not app.messaging_blocked(conversation_id)
    and split_part(storage_path, '/', 2) = (select auth.uid())::text
    and scan_status = 'pending'
  );

revoke insert, update, delete, truncate on public.conversations from anon, authenticated;
revoke insert, delete, truncate on public.conversation_members from anon, authenticated;
revoke update, delete, truncate on public.messages from anon, authenticated;
revoke insert, update, delete, truncate on public.messages from anon;
revoke insert on public.messages from authenticated;
grant insert (conversation_id, sender_id, kind, body, job_id) on public.messages to authenticated;

revoke update, delete, truncate on public.message_attachments from anon, authenticated;
revoke insert on public.message_attachments from anon, authenticated;
grant insert (message_id, conversation_id, storage_path, mime_type, size_bytes)
  on public.message_attachments to authenticated;

revoke insert, update, delete, truncate on public.user_blocks from anon;
revoke update, delete, truncate on public.reports from anon, authenticated;

-- ---------------------------------------------------------------------
-- Open, send, inbox, participants.
-- ---------------------------------------------------------------------
create or replace function public.open_conversation(
  p_organization_id uuid default null,
  p_worker_id uuid default null,
  p_application_id uuid default null,
  p_user_agent text default null,
  p_request_id text default null,
  p_ip text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_roles public.org_member_role[] := array['owner_admin', 'manager', 'recruiter_dispatcher']::public.org_member_role[];
  v_org uuid;
  v_worker uuid;
  v_job uuid;
  v_app uuid;
  v_type public.conversation_type;
  v_origin text;
  v_id uuid;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.status <> 'active'
  ) then
    raise exception 'account not active' using errcode = '42501';
  end if;

  if p_application_id is not null then
    select a.worker_id, a.job_id, j.organization_id
      into v_worker, v_job, v_org
    from public.applications a
    join public.jobs j on j.id = a.job_id
    where a.id = p_application_id;
    if v_worker is null then
      raise exception 'not found' using errcode = 'P0002';
    end if;
    if p_worker_id is not null and p_worker_id is distinct from v_worker then
      raise exception 'invalid input' using errcode = '22023';
    end if;
    if p_organization_id is not null and p_organization_id is distinct from v_org then
      raise exception 'invalid input' using errcode = '22023';
    end if;
    v_app := p_application_id;
    v_type := 'application';
    v_origin := 'application';
  else
    if p_organization_id is null or p_worker_id is null then
      raise exception 'invalid input' using errcode = '22023';
    end if;
    v_org := p_organization_id;
    v_worker := p_worker_id;
    if not exists (select 1 from public.organizations o where o.id = v_org) then
      raise exception 'not found' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.profiles p where p.id = v_worker and p.account_type = 'worker') then
      raise exception 'not found' using errcode = 'P0002';
    end if;

    select a.id, a.job_id
      into v_app, v_job
    from public.applications a
    join public.jobs j on j.id = a.job_id
    where a.worker_id = v_worker
      and j.organization_id = v_org
    order by a.created_at desc
    limit 1;

    if v_app is not null then
      v_type := 'application';
      v_origin := 'application';
    else
      select s.job_id
        into v_job
      from public.assignments s
      where s.worker_id = v_worker
        and s.organization_id = v_org
        and s.status in ('pending_confirmation', 'confirmed', 'in_progress', 'completed', 'disputed')
      order by s.created_at desc
      limit 1;
      if v_job is not null or exists (
        select 1 from public.assignments s
        where s.worker_id = v_worker
          and s.organization_id = v_org
          and s.status in ('pending_confirmation', 'confirmed', 'in_progress', 'completed', 'disputed')
      ) then
        v_type := 'assignment';
        v_origin := 'assignment';
        v_app := null;
      elsif v_uid <> v_worker and exists (
        select 1 from public.worker_profiles w
        where w.user_id = v_worker and w.is_searchable
      ) then
        v_type := 'direct';
        v_origin := 'outreach';
        v_job := null;
        v_app := null;
      else
        raise exception 'no relationship' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_worker = v_uid then
    if not exists (
      select 1 from public.profiles p
      where p.id = v_uid and p.account_type = 'worker' and p.status = 'active'
    ) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
  elsif not app.is_org_member(v_org, v_roles) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = v_worker and p.status <> 'active'
  ) then
    raise exception 'account not active' using errcode = '42501';
  end if;

  if v_app is not null then
    select c.id into v_existing
    from public.conversations c
    where c.application_id = v_app;
  else
    select c.id into v_existing
    from public.conversations c
    where c.organization_id = v_org
      and c.worker_id = v_worker
      and c.application_id is null;
  end if;

  if v_existing is null then
    if app.users_blocked(v_uid, v_worker) or exists (
      select 1
      from public.organization_members m
      where m.organization_id = v_org
        and app.users_blocked(v_uid, m.user_id)
    ) then
      raise exception 'blocked' using errcode = '42501';
    end if;
    perform app.assert_conversation_quota(v_uid, v_org, v_origin = 'outreach');
    begin
      insert into public.conversations (
        type, organization_id, job_id, application_id, created_by, worker_id, origin
      ) values (
        v_type, v_org, v_job, v_app, v_uid, v_worker, v_origin
      )
      returning id into v_id;
    exception
      when unique_violation then
        if v_app is not null then
          select c.id into v_id from public.conversations c where c.application_id = v_app;
        else
          select c.id into v_id
          from public.conversations c
          where c.organization_id = v_org
            and c.worker_id = v_worker
            and c.application_id is null;
        end if;
        if v_id is null then
          raise;
        end if;
        v_existing := v_id;
    end;
    if v_existing is null then
      insert into public.conversation_members (conversation_id, user_id)
      select v_id, v_worker
      union
      select v_id, m.user_id
      from public.organization_members m
      where m.organization_id = v_org
      on conflict do nothing;
      perform app.write_audit(
        'user', v_uid, v_org, 'conversation.open', 'conversation', v_id,
        null,
        pg_catalog.jsonb_build_object(
          'origin', v_origin,
          'worker_id', v_worker,
          'application_id', v_app,
          'job_id', v_job
        ),
        p_ip, p_user_agent, p_request_id
      );
    end if;
  else
    v_id := v_existing;
  end if;

  if not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = v_id
      and cm.user_id = v_uid
      and cm.left_at is null
  ) then
    if v_uid is distinct from v_worker and not app.is_org_member(v_org, v_roles) then
      raise exception 'not permitted' using errcode = '42501';
    end if;
    insert into public.conversation_members (conversation_id, user_id)
    values (v_id, v_uid)
    on conflict (conversation_id, user_id) do update
      set left_at = null
      where public.conversation_members.left_at is not null;
  end if;

  return v_id;
end
$$;

create or replace function public.send_message(
  p_conversation uuid,
  p_body text,
  p_job_id uuid default null,
  p_attachments jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_kind public.message_kind;
  v_body text := nullif(pg_catalog.btrim(coalesce(p_body, '')), '');
  v_count integer;
  v_item jsonb;
  v_path text;
  v_mime text;
  v_size bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_attachments is null then
    p_attachments := '[]'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_count := pg_catalog.jsonb_array_length(p_attachments);
  if v_count > 3 then
    raise exception 'attachment invalid' using errcode = '22023';
  end if;
  if p_job_id is not null and v_count > 0 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if p_job_id is not null then
    v_kind := 'job_card';
  elsif v_count > 0 then
    v_kind := 'attachment';
  else
    v_kind := 'text';
  end if;
  if v_kind = 'text' and v_body is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if v_body is not null and pg_catalog.char_length(v_body) > 8000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  insert into public.messages (conversation_id, sender_id, kind, body, job_id)
  values (p_conversation, v_uid, v_kind, v_body, p_job_id)
  returning id into v_id;

  for v_item in
    select value from pg_catalog.jsonb_array_elements(p_attachments)
  loop
    v_path := v_item->>'storage_path';
    v_mime := v_item->>'mime_type';
    if v_item->>'size_bytes' is null or v_path is null or v_mime is null then
      raise exception 'attachment invalid' using errcode = '22023';
    end if;
    v_size := (v_item->>'size_bytes')::bigint;
    insert into public.message_attachments (message_id, conversation_id, storage_path, mime_type, size_bytes)
    values (v_id, p_conversation, v_path, v_mime, v_size);
  end loop;

  return v_id;
end
$$;

create or replace function public.my_inbox(
  p_query text default null,
  p_archived boolean default false
)
returns table (
  conversation_id uuid,
  conversation_type public.conversation_type,
  origin text,
  organization_id uuid,
  organization_name text,
  worker_id uuid,
  counterpart_name text,
  job_id uuid,
  job_title text,
  application_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer,
  archived_at timestamptz,
  other_last_read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(pg_catalog.btrim(coalesce(p_query, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_query is not null and pg_catalog.char_length(v_query) < 2 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if v_query is not null and pg_catalog.char_length(v_query) > 80 then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  return query
  select
    c.id,
    c.type,
    c.origin,
    c.organization_id,
    o.name,
    c.worker_id,
    case
      when c.worker_id is null then coalesce(o.name, 'Conversation')
      when c.worker_id = auth.uid() then coalesce(o.name, 'Organization')
      else coalesce(wp.display_name, 'Worker')
    end,
    c.job_id,
    case
      when j.id is null then null
      when j.status = 'published'
        or app.is_org_member(j.organization_id)
        or exists (
          select 1 from public.applications a
          where a.job_id = j.id and a.worker_id = auth.uid()
        )
      then j.title
      else null
    end,
    c.application_id,
    c.last_message_at,
    (
      select case m.kind
        when 'job_card' then coalesce(pg_catalog.left(m.body, 140), 'Shift card')
        when 'attachment' then coalesce(pg_catalog.left(m.body, 140), 'Attachment')
        when 'voice' then 'Voice message'
        else pg_catalog.left(m.body, 140)
      end
      from public.messages m
      where m.conversation_id = c.id
        and m.deleted_at is null
      order by m.created_at desc
      limit 1
    ),
    (
      select count(*)::int
      from public.messages m
      where m.conversation_id = c.id
        and m.deleted_at is null
        and m.sender_id is distinct from auth.uid()
        and m.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)
    ),
    cm.archived_at,
    (
      select max(other.last_read_at)
      from public.conversation_members other
      where other.conversation_id = c.id
        and other.user_id <> auth.uid()
        and other.left_at is null
    )
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id
  left join public.organizations o on o.id = c.organization_id
  left join public.profiles wp on wp.id = c.worker_id
  left join public.jobs j on j.id = c.job_id
  where cm.user_id = auth.uid()
    and cm.left_at is null
    and (
      (coalesce(p_archived, false) and cm.archived_at is not null)
      or (not coalesce(p_archived, false) and cm.archived_at is null)
    )
    and (
      v_query is null
      or exists (
        select 1
        from public.messages m
        where m.conversation_id = c.id
          and m.deleted_at is null
          and app.ilike_contains(m.body, v_query)
      )
      or app.ilike_contains(o.name, v_query)
      or (c.worker_id is distinct from auth.uid() and app.ilike_contains(wp.display_name, v_query))
    )
  order by c.last_message_at desc nulls last, c.created_at desc
  limit 50;
end
$$;

comment on function public.my_inbox(text, boolean) is
  'Inbox for the signed-in member only. Search covers that member''s threads. Job titles follow the same visibility as the job row.';

create or replace function public.conversation_member_cards(p_conversation uuid)
returns table (
  user_id uuid,
  display_name text,
  last_read_at timestamptz,
  left_at timestamptz,
  is_worker boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_conversation_member(p_conversation) then
    return;
  end if;
  return query
  select cm.user_id, p.display_name, cm.last_read_at, cm.left_at, c.worker_id is not distinct from cm.user_id
  from public.conversation_members cm
  join public.profiles p on p.id = cm.user_id
  join public.conversations c on c.id = cm.conversation_id
  where cm.conversation_id = p_conversation
  order by p.display_name;
end
$$;

comment on function public.conversation_member_cards(uuid) is
  'Display names and read receipts for one thread the caller still belongs to. No email or phone.';

-- Moves last_read_at forward only when a newer message from someone else
-- exists, so opening a thread does not ping-pong realtime updates.
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.conversation_members cm
     set last_read_at = pg_catalog.now()
   where cm.conversation_id = p_conversation
     and cm.user_id = auth.uid()
     and cm.left_at is null
     and (
       cm.last_read_at is null
       or cm.last_read_at < coalesce((
         select max(m.created_at)
         from public.messages m
         where m.conversation_id = p_conversation
           and m.sender_id is distinct from auth.uid()
       ), cm.last_read_at)
     );
end
$$;

revoke all on function public.open_conversation(uuid, uuid, uuid, text, text, text) from public, anon;
revoke all on function public.send_message(uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.my_inbox(text, boolean) from public, anon;
revoke all on function public.conversation_member_cards(uuid) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.open_conversation(uuid, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.send_message(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.my_inbox(text, boolean) to authenticated;
grant execute on function public.conversation_member_cards(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Realtime. postgres_changes still applies table RLS. Private broadcast
-- and presence also require a matching realtime.messages policy.
-- Do not require private = true: authorize() probes omit that column
-- and it defaults to false.
-- ---------------------------------------------------------------------
alter table public.messages replica identity full;
alter table public.conversation_members replica identity full;
alter table public.conversations replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'supabase_realtime publication is missing';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members'
  ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;

-- realtime.messages is owned by supabase_realtime_admin. The migration
-- role cannot create policies on it. scripts/apply-realtime-policies.sh
-- applies supabase/realtime_authorization.sql as supabase_admin after reset.
-- Authorize() probes leave private null/false, so those policies must not
-- require private = true.
