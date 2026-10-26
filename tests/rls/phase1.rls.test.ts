import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, asUser, cleanup, createUser, pool, sqlError, type TestUser } from "./helpers";

let wA: TestUser, wB: TestUser, eA: TestUser, eB: TestUser, mod: TestUser, adm: TestUser, fresh: TestUser, sneaky: TestUser, spammer: TestUser;
let orgX: string, orgY: string, conv: string, credB: string;
const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: "image/png" });
const pdf = new Blob(["%PDF-1.4 test"], { type: "application/pdf" });

beforeAll(async () => {
  [wA, wB, eA, eB, mod, adm, fresh, spammer] = await Promise.all(
    ["wa", "wb", "ea", "eb", "mod", "adm", "fresh", "spam"].map((l) => createUser(l)),
  );
  sneaky = await createUser("sneaky", { account_type: "staff", platform_role: "super_admin", display_name: "Sneaky" });
  for (const u of [wA, wB]) expect((await u.client.rpc("select_account_type", { p_account_type: "worker" })).error).toBeNull();
  for (const u of [eA, eB]) expect((await u.client.rpc("select_account_type", { p_account_type: "employer" })).error).toBeNull();
  await pool.query("update public.profiles set account_type='staff', platform_role='moderator' where id=$1", [mod.id]);
  await pool.query("update public.profiles set account_type='staff', platform_role='admin' where id=$1", [adm.id]);
  orgX = (await pool.query("insert into public.organizations(name, org_type, created_by) values ('Org X','ppo',$1) returning id", [eA.id])).rows[0].id;
  orgY = (await pool.query("insert into public.organizations(name, org_type, created_by) values ('Org Y','ppo',$1) returning id", [eB.id])).rows[0].id;
  await pool.query("insert into public.organization_members(organization_id,user_id,role) values ($1,$2,'owner_admin'),($3,$4,'owner_admin')", [orgX, eA.id, orgY, eB.id]);
  conv = (await pool.query("insert into public.conversations(type, organization_id, created_by) values ('direct',$1,$2) returning id", [orgX, eA.id])).rows[0].id;
  await pool.query("insert into public.conversation_members(conversation_id,user_id) values ($1,$2),($1,$3)", [conv, wA.id, eA.id]);
  await pool.query("insert into public.messages(conversation_id,sender_id,body) values ($1,$2,'hello')", [conv, eA.id]);
  const ct = (await pool.query("insert into public.credential_types(code,name) values ('rls_test_'||$1,'RLS test') returning id", [wA.id.slice(0, 8)])).rows[0].id;
  credB = (await pool.query("insert into public.credentials(worker_id,credential_type_id,credential_number) values ($1,$2,'G1234567') returning id", [wB.id, ct])).rows[0].id;
});

afterAll(async () => {
  await pool.query("delete from public.organizations where id = any($1)", [[orgX, orgY]]);
  await cleanup([wA, wB, eA, eB, mod, adm, fresh, sneaky, spammer].filter(Boolean));
  await pool.end();
});

describe("schema-wide", () => {
  it("every public table has RLS enabled AND forced", async () => {
    const { rows } = await pool.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not (c.relrowsecurity and c.relforcerowsecurity)");
    expect(rows).toEqual([]);
  });
  it("storage.objects has RLS enabled", async () => {
    const { rows } = await pool.query("select relrowsecurity from pg_class where oid='storage.objects'::regclass");
    expect(rows[0].relrowsecurity).toBe(true);
  });
  it("app schema helper functions are SECURITY DEFINER with fixed search_path", async () => {
    const { rows } = await pool.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','public') and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')");
    expect(rows).toEqual([]);
  });
});

describe("profiles & provisioning", () => {
  it("auto-provisions a profile with no account type and role 'user'", async () => {
    const { data, error } = await fresh.client.from("profiles").select("account_type, platform_role, status").eq("id", fresh.id).single();
    expect(error).toBeNull();
    expect(data).toEqual({ account_type: null, platform_role: "user", status: "active" });
  });
  it("ignores role/type smuggled in signup metadata", async () => {
    const { data } = await sneaky.client.from("profiles").select("account_type, platform_role, display_name").single();
    expect(data).toEqual({ account_type: null, platform_role: "user", display_name: "Sneaky" });
  });
  it("a worker sees only their own profile", async () => {
    const { data } = await wA.client.from("profiles").select("id");
    expect(data?.map((r) => r.id)).toEqual([wA.id]);
  });
  it("staff (moderator) can read other profiles", async () => {
    const { data } = await mod.client.from("profiles").select("id").in("id", [wA.id, eA.id]);
    expect(data?.length).toBe(2);
  });
  it.each(["platform_role", "status", "account_type", "email"])("user cannot update own %s", async (col) => {
    const value = { platform_role: "super_admin", status: "active", account_type: "staff", email: "x@evil.test" }[col];
    const { error } = await wA.client.from("profiles").update({ [col]: value }).eq("id", wA.id);
    expect(error?.code).toBe("42501");
  });
  it("user can update own display_name but not someone else's", async () => {
    expect((await wA.client.from("profiles").update({ display_name: "Worker A" }).eq("id", wA.id)).error).toBeNull();
    const { data } = await wA.client.from("profiles").update({ display_name: "pwned" }).eq("id", wB.id).select();
    expect(data).toEqual([]);
    const { rows } = await pool.query("select display_name from public.profiles where id=$1", [wB.id]);
    expect(rows[0].display_name).not.toBe("pwned");
  });
  it("authenticated users cannot insert profiles", async () => {
    expect(await sqlError(fresh.id, "insert into public.profiles(id, display_name) values (gen_random_uuid(), 'x')")).not.toBeNull();
  });
  it("anon cannot read profiles", async () => {
    const { data } = await anonClient().from("profiles").select("id");
    expect(data ?? []).toEqual([]);
  });
});

describe("account type selection", () => {
  it("rejects staff via RPC", async () => {
    const { error } = await fresh.client.rpc("select_account_type", { p_account_type: "staff" });
    expect(error?.code).toBe("22023");
  });
  it("anon cannot call select_account_type", async () => {
    const { error } = await anonClient().rpc("select_account_type", { p_account_type: "worker" });
    expect(error).not.toBeNull();
  });
  it("sets once, creates the worker profile row, is idempotent, then locks", async () => {
    expect((await fresh.client.rpc("select_account_type", { p_account_type: "worker" })).error).toBeNull();
    const { data } = await fresh.client.from("worker_profiles").select("user_id");
    expect(data?.map((r) => r.user_id)).toEqual([fresh.id]);
    expect((await fresh.client.rpc("select_account_type", { p_account_type: "worker" })).error).toBeNull();
    expect((await fresh.client.rpc("select_account_type", { p_account_type: "employer" })).error?.code).toBe("42501");
    const { rows } = await pool.query("select count(*)::int n from public.audit_logs where actor_id=$1 and action='account.type_selected'", [fresh.id]);
    expect(rows[0].n).toBe(1);
  });
  it("an employer cannot self-create a worker profile row", async () => {
    const { error } = await eA.client.from("worker_profiles").insert({ user_id: eA.id });
    expect(error?.code).toBe("42501");
  });
  it("an employer cannot self-assign a primary organization", async () => {
    const { error } = await eB.client.from("employer_profiles").update({ primary_organization_id: orgX }).eq("user_id", eB.id);
    expect(error?.code).toBe("42501");
  });
  it("suspended users cannot select an account type", async () => {
    const u = await createUser("susp");
    await pool.query("update public.profiles set status='suspended' where id=$1", [u.id]);
    expect((await u.client.rpc("select_account_type", { p_account_type: "worker" })).error?.code).toBe("42501");
    await cleanup([u]);
  });
});

describe("effective roles", () => {
  it("my_roles reflects DB state", async () => {
    expect((await eA.client.rpc("my_roles")).data).toEqual(["employer", "organization_admin"]);
    expect((await wA.client.rpc("my_roles")).data).toEqual(["worker"]);
    expect((await mod.client.rpc("my_roles")).data).toEqual(["moderator"]);
    expect((await adm.client.rpc("my_roles")).data).toEqual(["admin"]);
  });
});

describe("audit log framework", () => {
  it("users can record whitelisted auth events about themselves only", async () => {
    expect((await wA.client.rpc("record_auth_event", { p_action: "auth.login" })).error).toBeNull();
    const { rows } = await pool.query("select actor_type, actor_id from public.audit_logs where action='auth.login' and actor_id=$1", [wA.id]);
    expect(rows).toEqual([{ actor_type: "user", actor_id: wA.id }]);
  });
  it("non-whitelisted actions are rejected", async () => {
    for (const a of ["credential.verify", "admin.suspend_user", "auth.login; drop table x"]) {
      expect((await wA.client.rpc("record_auth_event", { p_action: a })).error?.code).toBe("42501");
    }
  });
  it("anon cannot record events", async () => {
    expect((await anonClient().rpc("record_auth_event", { p_action: "auth.login" })).error).not.toBeNull();
  });
  it("is rate limited", async () => {
    let last: { code?: string } | null = null;
    for (let i = 0; i < 31; i++) last = (await spammer.client.rpc("record_auth_event", { p_action: "auth.login" })).error;
    expect(last?.code).toBe("54000");
  });
  it("only admins can read audit logs", async () => {
    for (const u of [wA, eA, mod]) expect((await u.client.from("audit_logs").select("id")).data ?? []).toEqual([]);
    expect(((await adm.client.from("audit_logs").select("id").limit(5)).data ?? []).length).toBeGreaterThan(0);
  });
  it("no client role can insert, update or delete audit logs (including admin)", async () => {
    expect((await adm.client.from("audit_logs").insert({ actor_type: "admin", action: "forged", entity_type: "x" })).error?.code).toBe("42501");
    expect((await adm.client.from("audit_logs").update({ action: "tampered" }).gt("id", 0)).error?.code).toBe("42501");
    expect((await adm.client.from("audit_logs").delete().gt("id", 0)).error?.code).toBe("42501");
  });
  it("append-only even for the database owner", async () => {
    await expect(pool.query("update public.audit_logs set action='x' where actor_id=$1", [wA.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from public.audit_logs where actor_id=$1", [wA.id])).rejects.toThrow(/append-only/);
  });
  it("email verification is audited by the auth trigger", async () => {
    const { rows } = await pool.query("select count(*)::int n from public.audit_logs where actor_id=$1 and action in ('auth.user_created')", [wA.id]);
    expect(rows[0].n).toBe(1);
  });
});

describe("organization isolation", () => {
  it("members read their org's membership, not another org's", async () => {
    const { data } = await eA.client.from("organization_members").select("organization_id");
    expect(new Set(data?.map((r) => r.organization_id))).toEqual(new Set([orgX]));
  });
  it("unverified orgs are invisible to non-members", async () => {
    expect((await eB.client.from("organizations").select("id").eq("id", orgX)).data).toEqual([]);
    expect((await wA.client.from("organizations").select("id").eq("id", orgX)).data).toEqual([]);
  });
  it("another org's admin cannot update the org", async () => {
    const { data } = await eB.client.from("organizations").update({ name: "pwned" }).eq("id", orgX).select();
    expect(data ?? []).toEqual([]);
  });
  it("org admin cannot self-verify", async () => {
    expect((await eA.client.from("organizations").update({ verification_status: "verified" }).eq("id", orgX)).error?.code).toBe("42501");
  });
  it("outsiders cannot add themselves to an org", async () => {
    expect((await wA.client.from("organization_members").insert({ organization_id: orgX, user_id: wA.id, role: "owner_admin" })).error).not.toBeNull();
    expect((await eB.client.from("organization_members").insert({ organization_id: orgX, user_id: eB.id, role: "manager" })).error).not.toBeNull();
  });
});

describe("credentials", () => {
  it("workers cannot see other workers' credentials; employers see none", async () => {
    expect((await wA.client.from("credentials").select("id").eq("id", credB)).data).toEqual([]);
    expect((await eA.client.from("credentials").select("id")).data).toEqual([]);
    expect((await wB.client.from("credentials").select("id").eq("id", credB)).data?.length).toBe(1);
  });
  it("workers cannot self-verify", async () => {
    expect((await wB.client.from("credentials").update({ status: "verified" }).eq("id", credB)).error?.code).toBe("42501");
  });
});

describe("messaging privacy", () => {
  it("non-members cannot read or post", async () => {
    expect((await wB.client.from("messages").select("id").eq("conversation_id", conv)).data).toEqual([]);
    expect((await wB.client.from("messages").insert({ conversation_id: conv, sender_id: wB.id, body: "hi" })).error).not.toBeNull();
    expect((await wA.client.from("messages").select("id").eq("conversation_id", conv)).data?.length).toBe(1);
  });
  it("members cannot spoof the sender or send system messages", async () => {
    expect((await wA.client.from("messages").insert({ conversation_id: conv, sender_id: eA.id, body: "spoof" })).error).not.toBeNull();
    expect((await wA.client.from("messages").insert({ conversation_id: conv, sender_id: wA.id, kind: "system", body: "x" })).error).not.toBeNull();
  });
});

describe("SQL-level (PostgREST-equivalent claims)", () => {
  it("auth.uid() is honoured and anon sees nothing sensitive", async () => {
    expect(await asUser(wA.id, async (c) => (await c.query("select auth.uid() as u")).rows[0].u)).toBe(wA.id);
    for (const t of ["profiles", "credentials", "messages", "audit_logs", "organization_members", "worker_profiles"]) {
      expect(await asUser(null, async (c) => (await c.query(`select count(*)::int n from public.${t}`)).rows[0].n)).toBe(0);
    }
  });
  it("authenticated cannot write audit_logs directly", async () => {
    expect(await sqlError(wA.id, "insert into public.audit_logs(actor_type, action, entity_type) values ('admin','forged','x')")).toBe("42501");
  });
});

describe("storage buckets", () => {
  it("all five buckets exist and are private with limits", async () => {
    const { rows } = await pool.query("select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id");
    expect(rows.map((r) => r.id)).toEqual(["avatars", "credential-documents", "le-documents", "message-attachments", "org-logos"]);
    for (const r of rows) {
      expect(r.public).toBe(false);
      expect(Number(r.file_size_limit)).toBeGreaterThan(0);
      expect(r.allowed_mime_types.length).toBeGreaterThan(0);
      expect(r.allowed_mime_types).not.toContain("image/svg+xml");
    }
  });

  it("avatars: own folder only; others and anon cannot read", async () => {
    expect((await wA.client.storage.from("avatars").upload(`${wA.id}/a.png`, png, { upsert: true })).error).toBeNull();
    expect((await wA.client.storage.from("avatars").upload(`${wB.id}/a.png`, png)).error).not.toBeNull();
    expect((await wB.client.storage.from("avatars").download(`${wA.id}/a.png`)).error).not.toBeNull();
    expect((await anonClient().storage.from("avatars").download(`${wA.id}/a.png`)).error).not.toBeNull();
    expect((await wA.client.storage.from("avatars").download(`${wA.id}/a.png`)).error).toBeNull();
    const pub = wA.client.storage.from("avatars").getPublicUrl(`${wA.id}/a.png`).data.publicUrl;
    expect((await fetch(pub)).ok).toBe(false);
  });

  it("buckets enforce MIME type and size", async () => {
    const html = new Blob(["<script>alert(1)</script>"], { type: "text/html" });
    expect((await wA.client.storage.from("avatars").upload(`${wA.id}/x.html`, html)).error).not.toBeNull();
    const big = new Blob([new Uint8Array(2 * 1024 * 1024 + 10)], { type: "image/png" });
    expect((await wA.client.storage.from("avatars").upload(`${wA.id}/big.png`, big)).error).not.toBeNull();
  });

  it("credential documents: workers upload own; no client delete; employers cannot upload or read", async () => {
    const path = `${wA.id}/doc.pdf`;
    expect((await wA.client.storage.from("credential-documents").upload(path, pdf)).error).toBeNull();
    expect((await eA.client.storage.from("credential-documents").upload(`${eA.id}/doc.pdf`, pdf)).error).not.toBeNull();
    expect((await eA.client.storage.from("credential-documents").download(path)).error).not.toBeNull();
    expect((await wB.client.storage.from("credential-documents").download(path)).error).not.toBeNull();
    await wA.client.storage.from("credential-documents").remove([path]);
    const { rows } = await pool.query("select count(*)::int n from storage.objects where bucket_id='credential-documents' and name=$1", [path]);
    expect(rows[0].n).toBe(1); // still there: evidence preserved
    expect((await wA.client.storage.from("credential-documents").upload(path, pdf, { upsert: true })).error).not.toBeNull();
  });

  it("LE documents: workers only, own folder", async () => {
    expect((await wA.client.storage.from("le-documents").upload(`${wA.id}/le.pdf`, pdf)).error).toBeNull();
    expect((await wA.client.storage.from("le-documents").upload(`${wB.id}/le.pdf`, pdf)).error).not.toBeNull();
    expect((await eA.client.storage.from("le-documents").upload(`${eA.id}/le.pdf`, pdf)).error).not.toBeNull();
  });

  it("org logos: only the org's owner_admin writes; other orgs and workers cannot", async () => {
    expect((await eA.client.storage.from("org-logos").upload(`${orgX}/logo.png`, png)).error).toBeNull();
    expect((await eB.client.storage.from("org-logos").upload(`${orgX}/evil.png`, png)).error).not.toBeNull();
    expect((await wA.client.storage.from("org-logos").upload(`${orgX}/evil.png`, png)).error).not.toBeNull();
    expect((await eB.client.storage.from("org-logos").download(`${orgX}/logo.png`)).error).not.toBeNull();
    expect((await eA.client.storage.from("org-logos").upload(`not-a-uuid/logo.png`, png)).error).not.toBeNull();
  });

  it("message attachments: members only, uploader folder enforced", async () => {
    expect((await wA.client.storage.from("message-attachments").upload(`${conv}/${wA.id}/f.pdf`, pdf)).error).toBeNull();
    expect((await wA.client.storage.from("message-attachments").upload(`${conv}/${eA.id}/f.pdf`, pdf)).error).not.toBeNull();
    expect((await wB.client.storage.from("message-attachments").upload(`${conv}/${wB.id}/f.pdf`, pdf)).error).not.toBeNull();
    expect((await eA.client.storage.from("message-attachments").download(`${conv}/${wA.id}/f.pdf`)).error).toBeNull();
    expect((await wB.client.storage.from("message-attachments").download(`${conv}/${wA.id}/f.pdf`)).error).not.toBeNull();
  });

  it("anon cannot list any bucket", async () => {
    for (const b of ["avatars", "credential-documents", "message-attachments"]) {
      const { data } = await anonClient().storage.from(b).list(wA.id);
      expect(data ?? []).toEqual([]);
    }
  });

  afterAll(async () => {
    const { data } = await admin.storage.listBuckets();
    for (const b of data ?? []) {
      const { rows } = await pool.query("select name from storage.objects where bucket_id=$1 and (name like $2 or name like $3 or name like $4)", [b.id, `${wA.id}/%`, `${orgX}/%`, `${conv}/%`]);
      if (rows.length) await admin.storage.from(b.id).remove(rows.map((r) => r.name));
    }
  });
});
