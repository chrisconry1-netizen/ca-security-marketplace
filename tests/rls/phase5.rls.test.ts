import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, asUser, cleanup, createUser, pool, type TestUser } from "./helpers";

let worker: TestUser;
let outsider: TestUser;
let employer: TestUser;
let colleague: TestUser;
let quiet: TestUser;
let moderator: TestUser;
const extras: TestUser[] = [];
let orgId: string;
let jobId: string;
let applicationId: string;
let conversationId: string;

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function authorize(role: "authenticated" | "anon", topic: string, uid: string | null, read: string[], write: string[]) {
  const claims = JSON.stringify(uid ? { sub: uid, role } : { role });
  const { rows } = await pool.query(
    "select read_allowed, write_allowed from realtime.authorize($1, $2, $3, $4, '{}', $5::text[], $6::text[])",
    [role, topic, claims, uid ?? "", read, write],
  );
  return rows[0] as { read_allowed: boolean[]; write_allowed: boolean[] };
}

async function saveOpenJob() {
  const draft = await employer.client.rpc("save_job_draft", {
    p_organization_id: orgId,
    p_job_id: null,
    p_title: "Messaging lobby shift",
    p_description: "Lobby coverage for the messaging test.",
    p_job_type: "single_shift",
    p_category: "unarmed_security",
    p_is_armed: false,
    p_urgency: "normal",
    p_city: "Oakland",
    p_county: "Alameda",
    p_postal_code: "94612",
    p_site_address_private: "400 Broadway",
    p_site_lat: 37.8044,
    p_site_lng: -122.2712,
    p_approx_lat: null,
    p_approx_lng: null,
    p_starts_local: "2026-11-15T09:00",
    p_ends_local: "2026-11-15T17:00",
    p_pay_type: "hourly",
    p_pay_min_cents: 2800,
    p_pay_max_cents: null,
    p_workers_needed: 1,
    p_min_years: null,
    p_uniform_notes: null,
    p_vehicle_required: false,
    p_equipment_notes: null,
    p_deadline_local: null,
    p_required_codes: [],
    p_optional_codes: [],
  });
  if (draft.error || !draft.data) throw new Error(draft.error?.message ?? "draft failed");
  const published = await employer.client.rpc("publish_job", { p_job_id: draft.data });
  if (published.error) throw new Error(published.error.message);
  return draft.data as string;
}

beforeAll(async () => {
  [worker, outsider, employer, colleague, quiet, moderator] = await Promise.all(
    ["p5w", "p5o", "p5e", "p5c", "p5q", "p5m"].map((label) => createUser(label, { display_name: label })),
  );
  for (let i = 0; i < 5; i += 1) extras.push(await createUser(`p5x${i}`, { display_name: `Extra ${i}` }));
  for (const user of [worker, outsider, quiet, ...extras]) {
    const selected = await user.client.rpc("select_account_type", { p_account_type: "worker" });
    if (selected.error) throw new Error(selected.error.message);
  }
  for (const user of [employer, colleague]) {
    const selected = await user.client.rpc("select_account_type", { p_account_type: "employer" });
    if (selected.error) throw new Error(selected.error.message);
  }
  await pool.query("update public.profiles set account_type='staff', platform_role='moderator' where id=$1", [moderator.id]);
  await pool.query("update public.profiles set display_name='Worker Five' where id=$1", [worker.id]);
  const created = await employer.client.rpc("create_organization", { p_name: `Msg Org ${worker.id.slice(0, 8)}`, p_org_type: "ppo" });
  if (created.error || !created.data) throw new Error(created.error?.message ?? "org failed");
  orgId = created.data as string;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.org_verification_transition', '1', true)");
    await client.query("update public.organizations set verification_status='pending' where id=$1", [orgId]);
    await client.query("update public.organizations set verification_status='verified', verified_at=now() where id=$1", [orgId]);
    await client.query("commit");
  } finally {
    client.release();
  }
  jobId = await saveOpenJob();
  const applied = await worker.client.rpc("submit_application", { p_job_id: jobId, p_note: "I can cover the lobby." });
  if (applied.error || !applied.data) throw new Error(applied.error?.message ?? "apply failed");
  applicationId = applied.data as string;
  const opened = await employer.client.rpc("open_conversation", { p_application_id: applicationId });
  if (opened.error || !opened.data) throw new Error(opened.error?.message ?? "open failed");
  conversationId = opened.data as string;
  const hello = await employer.client.rpc("send_message", { p_conversation: conversationId, p_body: "Lobby briefing is posted." });
  if (hello.error) throw new Error(hello.error.message);
});

afterAll(async () => {
  if (orgId) {
    await pool.query("delete from public.assignments where organization_id=$1", [orgId]);
    await pool.query("delete from public.jobs where organization_id=$1", [orgId]);
    await pool.query("delete from public.organizations where id=$1", [orgId]);
  }
  await cleanup([worker, outsider, employer, colleague, quiet, moderator, ...extras].filter(Boolean));
  await pool.end();
});

describe("messaging access", () => {
  it("gives anon no rows and no realtime authorization", async () => {
    expect(await asUser(null, async (c) => (await c.query("select count(*)::int n from public.messages")).rows[0].n)).toBe(0);
    expect((await anonClient().from("messages").insert({ conversation_id: conversationId, sender_id: outsider.id, body: "nope" })).error).not.toBeNull();
    const anon = await authorize("anon", `conversation:${conversationId}`, null, ["broadcast", "postgres_changes"], ["broadcast"]);
    expect(anon.read_allowed).toEqual([false, false]);
    expect(anon.write_allowed).toEqual([false]);
    expect((await anonClient().rpc("open_conversation", { p_application_id: applicationId })).error).not.toBeNull();
    expect((await anonClient().rpc("my_inbox")).error).not.toBeNull();
  });

  it("hides another conversation from select, insert, membership, and realtime", async () => {
    expect((await outsider.client.from("conversations").select("id").eq("id", conversationId)).data).toEqual([]);
    expect((await outsider.client.from("messages").select("body").eq("conversation_id", conversationId)).data).toEqual([]);
    expect((await outsider.client.from("conversation_members").select("user_id").eq("conversation_id", conversationId)).data).toEqual([]);
    expect((await outsider.client.from("message_attachments").select("id").eq("conversation_id", conversationId)).data).toEqual([]);
    expect((await outsider.client.from("messages").insert({ conversation_id: conversationId, sender_id: outsider.id, body: "intrude" })).error?.code).toBe("42501");
    expect((await outsider.client.from("conversations").insert({ type: "direct", organization_id: orgId, created_by: outsider.id })).error?.code).toBe("42501");
    expect((await outsider.client.from("conversation_members").insert({ conversation_id: conversationId, user_id: outsider.id })).error?.code).toBe("42501");
    const topic = `conversation:${conversationId}`;
    const denied = await authorize("authenticated", topic, outsider.id, ["broadcast", "presence", "postgres_changes"], ["broadcast", "presence"]);
    expect(denied.read_allowed).toEqual([false, false, false]);
    expect(denied.write_allowed).toEqual([false, false]);
    const inbox = await authorize("authenticated", `inbox:${worker.id}`, outsider.id, ["broadcast"], ["broadcast"]);
    expect(inbox.read_allowed).toEqual([false]);
    expect(inbox.write_allowed).toEqual([false]);
  });

  it("lets a member subscribe to changes and broadcast, not write postgres changes", async () => {
    const topic = `conversation:${conversationId}`;
    const allowed = await authorize(
      "authenticated",
      topic,
      worker.id,
      ["broadcast", "presence", "postgres_changes"],
      ["broadcast", "presence", "postgres_changes"],
    );
    expect(allowed.read_allowed).toEqual([true, true, true]);
    expect(allowed.write_allowed).toEqual([true, true, false]);
    const ownInbox = await authorize("authenticated", `inbox:${worker.id}`, worker.id, ["broadcast"], ["broadcast"]);
    expect(ownInbox.read_allowed).toEqual([true]);
    expect(ownInbox.write_allowed).toEqual([true]);
  });

  it("rejects spoofed senders, voice, system, and edits", async () => {
    expect((await worker.client.from("messages").insert({ conversation_id: conversationId, sender_id: employer.id, body: "spoof" })).error?.code).toBe("42501");
    expect((await worker.client.from("messages").insert({ conversation_id: conversationId, sender_id: worker.id, kind: "system", body: "sys" })).error?.code).toBe("42501");
    expect((await worker.client.from("messages").insert({ conversation_id: conversationId, sender_id: worker.id, kind: "voice", body: "voice" })).error?.code).toBe("42501");
    const { data } = await worker.client.from("messages").select("id").eq("conversation_id", conversationId).limit(1);
    const messageId = data?.[0]?.id as string;
    expect((await worker.client.from("messages").update({ body: "edited" }).eq("id", messageId)).error?.code).toBe("42501");
    expect((await worker.client.from("messages").delete().eq("id", messageId)).error?.code).toBe("42501");
    const { rows } = await pool.query("select body from public.messages where id=$1", [messageId]);
    expect(rows[0].body).not.toBe("edited");
  });

  it("keeps a moderator from reading message bodies", async () => {
    expect((await moderator.client.from("messages").select("body").eq("conversation_id", conversationId)).data).toEqual([]);
  });

  it("blocks both directions and still allows the report", async () => {
    expect((await worker.client.from("user_blocks").insert({ blocker_id: worker.id, blocked_id: employer.id })).error).toBeNull();
    expect((await employer.client.rpc("send_message", { p_conversation: conversationId, p_body: "after block" })).error?.message).toMatch(/blocked/);
    expect((await worker.client.rpc("send_message", { p_conversation: conversationId, p_body: "after block" })).error?.message).toMatch(/blocked/);
    const blockedChannel = await authorize("authenticated", `conversation:${conversationId}`, employer.id, ["broadcast"], ["broadcast"]);
    expect(blockedChannel.write_allowed).toEqual([false]);
    expect((await worker.client.from("messages").select("id").eq("conversation_id", conversationId)).data?.length).toBeGreaterThan(0);
    await pool.query("delete from public.user_blocks where blocker_id=$1 and blocked_id=$2", [worker.id, employer.id]);
    expect((await employer.client.from("user_blocks").insert({ blocker_id: employer.id, blocked_id: worker.id })).error).toBeNull();
    expect((await worker.client.rpc("send_message", { p_conversation: conversationId, p_body: "still blocked" })).error?.message).toMatch(/blocked/);
    await pool.query("delete from public.user_blocks where blocker_id=$1 and blocked_id=$2", [employer.id, worker.id]);
    const restored = await worker.client.rpc("send_message", { p_conversation: conversationId, p_body: "unblocked again" });
    expect(restored.error).toBeNull();
  });

  it("syncs organization members and drops access when they leave", async () => {
    await pool.query("insert into public.organization_members(organization_id, user_id, role) values ($1,$2,'manager')", [orgId, colleague.id]);
    expect((await colleague.client.from("messages").select("body").eq("conversation_id", conversationId)).data?.length).toBeGreaterThan(0);
    const path = `${conversationId}/${employer.id}/${crypto.randomUUID()}.png`;
    const uploaded = await employer.client.storage.from("message-attachments").upload(path, png, { contentType: "image/png" });
    expect(uploaded.error).toBeNull();
    expect((await colleague.client.storage.from("message-attachments").download(path)).error).toBeNull();
    await pool.query("delete from public.organization_members where organization_id=$1 and user_id=$2", [orgId, colleague.id]);
    expect((await colleague.client.from("messages").select("id").eq("conversation_id", conversationId)).data).toEqual([]);
    expect((await colleague.client.storage.from("message-attachments").download(path)).error).not.toBeNull();
    expect((await colleague.client.rpc("send_message", { p_conversation: conversationId, p_body: "removed" })).error).not.toBeNull();
    expect((await outsider.client.storage.from("message-attachments").download(path)).error).not.toBeNull();
    await admin.storage.from("message-attachments").remove([path]);
  });

  it("refuses a cold message and enforces outreach and conversation caps", async () => {
    expect((await quiet.client.rpc("open_conversation", { p_organization_id: orgId, p_worker_id: quiet.id })).error?.message).toMatch(/no relationship/);
    expect((await employer.client.rpc("open_conversation", { p_organization_id: orgId, p_worker_id: quiet.id })).error?.message).toMatch(/no relationship/);
    expect((await worker.client.from("worker_profiles").update({ is_searchable: true, city: "Oakland", county: "Alameda" }).eq("user_id", worker.id)).error).toBeNull();
    const again = await employer.client.rpc("open_conversation", { p_organization_id: orgId, p_worker_id: worker.id });
    expect(again.data).toBe(conversationId);
    for (const extra of extras) {
      expect((await extra.client.from("worker_profiles").update({ is_searchable: true, city: "Oakland" }).eq("user_id", extra.id)).error).toBeNull();
      const opened = await employer.client.rpc("open_conversation", { p_organization_id: orgId, p_worker_id: extra.id });
      expect(opened.error, opened.error?.message).toBeNull();
    }
    const sixth = await employer.client.rpc("open_conversation", { p_organization_id: orgId, p_worker_id: quiet.id });
    expect(sixth.error?.message).toMatch(/no relationship|outreach rate limit/);
    expect((await quiet.client.from("worker_profiles").update({ is_searchable: true, city: "Oakland" }).eq("user_id", quiet.id)).error).toBeNull();
    const capped = await employer.client.rpc("open_conversation", { p_organization_id: orgId, p_worker_id: quiet.id });
    expect(capped.error?.message).toMatch(/outreach rate limit/);
    await pool.query(
      "insert into public.conversations(type, organization_id, created_by, origin) select 'direct', $1, $2, null from generate_series(1,40)",
      [orgId, employer.id],
    );
    const over = await employer.client.rpc("open_conversation", { p_organization_id: orgId, p_worker_id: quiet.id });
    expect(over.error?.message).toMatch(/conversation rate limit|outreach rate limit/);
    await pool.query("delete from public.conversations where organization_id=$1 and worker_id is null and origin is null", [orgId]);
  });

  it("does not flag a message when it is reported, and rejects a report from outside", async () => {
    const { rows } = await pool.query("select id, is_flagged from public.messages where conversation_id=$1 limit 1", [conversationId]);
    const reported = await worker.client.from("reports").insert({
      reporter_id: worker.id,
      target_type: "message",
      target_id: rows[0].id,
      reason: "harassment",
      status: "open",
    });
    expect(reported.error).toBeNull();
    const flag = await pool.query("select is_flagged from public.messages where id=$1", [rows[0].id]);
    expect(flag.rows[0].is_flagged).toBe(false);
    const conversationReport = await worker.client.from("reports").insert({
      reporter_id: worker.id,
      target_type: "conversation",
      target_id: conversationId,
      reason: "spam",
      status: "open",
    });
    expect(conversationReport.error).toBeNull();
    expect((await outsider.client.from("reports").insert({
      reporter_id: outsider.id,
      target_type: "message",
      target_id: rows[0].id,
      reason: "spam",
      status: "open",
    })).error).not.toBeNull();
  });

  it("searches and archives only the caller's own threads", async () => {
    const found = await employer.client.rpc("my_inbox", { p_query: "Lobby briefing" });
    expect(found.error).toBeNull();
    expect((found.data as { conversation_id: string }[]).some((row) => row.conversation_id === conversationId)).toBe(true);
    const hidden = await outsider.client.rpc("my_inbox", { p_query: "Lobby briefing" });
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
    const names = await outsider.client.rpc("conversation_member_cards", { p_conversation: conversationId });
    expect(names.data).toEqual([]);
    expect((await employer.client.from("conversation_members").update({ archived_at: new Date().toISOString() }).eq("conversation_id", conversationId).eq("user_id", employer.id)).error).toBeNull();
    const archived = await employer.client.rpc("my_inbox", { p_archived: true });
    expect((archived.data as { conversation_id: string }[]).some((row) => row.conversation_id === conversationId)).toBe(true);
    const workerInbox = await worker.client.rpc("my_inbox", { p_archived: false });
    expect((workerInbox.data as { conversation_id: string }[]).some((row) => row.conversation_id === conversationId)).toBe(true);
    await pool.query("update public.conversation_members set archived_at=null where conversation_id=$1", [conversationId]);
  });

  it("publishes the messaging tables with full replica identity", async () => {
    const { rows } = await pool.query(
      "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by tablename",
    );
    expect(rows.map((row) => row.tablename)).toEqual(expect.arrayContaining(["conversations", "conversation_members", "messages"]));
    const identity = await pool.query(
      "select c.relname, c.relreplident from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in ('messages','conversation_members','conversations')",
    );
    for (const row of identity.rows) expect(row.relreplident).toBe("f");
  });

  it("stores an attachment only when the storage object matches the sender", async () => {
    const path = `${conversationId}/${worker.id}/${crypto.randomUUID()}.png`;
    const uploaded = await worker.client.storage.from("message-attachments").upload(path, png, { contentType: "image/png" });
    expect(uploaded.error, uploaded.error?.message).toBeNull();
    const sent = await worker.client.rpc("send_message", {
      p_conversation: conversationId,
      p_body: "photo",
      p_attachments: [{ storage_path: path, mime_type: "image/png", size_bytes: png.byteLength }],
    });
    expect(sent.error, sent.error?.message).toBeNull();
    expect((await outsider.client.from("message_attachments").select("storage_path").eq("storage_path", path)).data).toEqual([]);
    const forged = `${conversationId}/${employer.id}/${crypto.randomUUID()}.png`;
    expect((await worker.client.rpc("send_message", {
      p_conversation: conversationId,
      p_body: "forged path",
      p_attachments: [{ storage_path: forged, mime_type: "image/png", size_bytes: png.byteLength }],
    })).error).not.toBeNull();
    await admin.storage.from("message-attachments").remove([path]);
  });

  it("delivers a private channel event to a member and not to an outsider", async () => {
    const topic = `conversation:${conversationId}`;
    const memberChannel = worker.client.channel(topic, { config: { private: true } });
    const outsiderChannel = outsider.client.channel(topic, { config: { private: true } });
    const memberStatus = new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("TIMEOUT"), 8000);
      memberChannel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          resolve(status);
        }
      });
    });
    const outsiderStatus = new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("TIMEOUT"), 8000);
      outsiderChannel.subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          resolve(status);
        }
      });
    });
    try {
      expect(await memberStatus).toBe("SUBSCRIBED");
      expect(await outsiderStatus).not.toBe("SUBSCRIBED");
    } finally {
      await worker.client.removeChannel(memberChannel);
      await outsider.client.removeChannel(outsiderChannel);
      await worker.client.realtime.disconnect();
      await outsider.client.realtime.disconnect();
    }
  }, 20_000);
});
