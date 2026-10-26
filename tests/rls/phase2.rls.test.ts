import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CREDENTIAL_TYPE_CODES, SECURITY_CATEGORIES } from "@/lib/workers/categories";
import { admin, anonClient, cleanup, createUser, pool, sqlError, type TestUser } from "./helpers";

let wA: TestUser, wB: TestUser, employer: TestUser, mod: TestUser, fresh: TestUser;
let typeId: string;
let credA: string;
const pdf = new Blob([Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")], { type: "application/pdf" });

async function pacificDate(offsetDays: number): Promise<string> {
  const { rows } = await pool.query("select (app.pacific_today() + $1::int)::text as d", [offsetDays]);
  return rows[0].d;
}

beforeAll(async () => {
  [wA, wB, employer, mod, fresh] = await Promise.all(["p2a", "p2b", "p2e", "p2m", "p2f"].map((label) => createUser(label)));
  for (const u of [wA, wB]) expect((await u.client.rpc("select_account_type", { p_account_type: "worker" })).error).toBeNull();
  expect((await employer.client.rpc("select_account_type", { p_account_type: "employer" })).error).toBeNull();
  await pool.query("update public.profiles set account_type='staff', platform_role='moderator' where id=$1", [mod.id]);
  typeId = (await pool.query("select id from public.credential_types where code='ca_guard_registration'")).rows[0].id;
});

afterAll(async () => {
  await cleanup([wA, wB, employer, mod, fresh].filter(Boolean));
  await pool.end();
});

describe("advisor hardening", () => {
  it("sets search_path on the three flagged helpers", async () => {
    const { rows } = await pool.query(
      `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='app' and proname in ('audit_logs_immutable','set_updated_at','try_uuid')
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it("does not leave a bare auth.uid() in public or storage policies", async () => {
    const { rows } = await pool.query(
      `select n.nspname, c.relname, pol.polname
       from pg_policy pol
       join pg_class c on c.oid = pol.polrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public','storage')
         and (
           regexp_replace(lower(coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')), '\\(\\s*select\\s+auth\\.uid\\(\\)(\\s+as\\s+[a-z0-9_]+)?\\s*\\)', '', 'g') ~ 'auth\\.uid\\s*\\('
           or regexp_replace(lower(coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')), '\\(\\s*select\\s+auth\\.uid\\(\\)(\\s+as\\s+[a-z0-9_]+)?\\s*\\)', '', 'g') ~ 'auth\\.uid\\s*\\('
         )`,
    );
    expect(rows).toEqual([]);
  });

  it("indexes every public foreign key", async () => {
    const { rows } = await pool.query(
      `select c.conname
       from pg_constraint c
       where c.contype='f' and c.connamespace='public'::regnamespace
         and not exists (
           select 1 from pg_index i
           where i.indrelid=c.conrelid and i.indisvalid and i.indpred is null
             and (string_to_array(i.indkey::text, ' ')::smallint[])[1:array_length(c.conkey, 1)] = c.conkey
         )`,
    );
    expect(rows).toEqual([]);
  });
});

describe("reference data", () => {
  it("seeds credential types and keeps security categories aligned", async () => {
    const types = await pool.query("select code from public.credential_types where code = any($1::text[]) order by code", [CREDENTIAL_TYPE_CODES]);
    expect(types.rows.map((r) => r.code)).toEqual([...CREDENTIAL_TYPE_CODES].sort());
    const categories = await pool.query("select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='security_category' order by e.enumsortorder");
    expect(categories.rows.map((r) => r.enumlabel)).toEqual(SECURITY_CATEGORIES.map((c) => c.code));
  });

  it("has no street-address column on worker profiles", async () => {
    const { rows } = await pool.query(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='worker_profiles'
         and column_name ~* 'street|address|address_line'`,
    );
    expect(rows).toEqual([]);
  });
});

describe("worker profile isolation", () => {
  it("a worker cannot read or modify another worker profile", async () => {
    expect((await wA.client.from("worker_profiles").update({ headline: "Mine", city: "Oakland", is_searchable: false }).eq("user_id", wA.id)).error).toBeNull();
    const { data: own } = await wA.client.from("worker_profiles").select("user_id");
    expect(own?.map((r) => r.user_id)).toEqual([wA.id]);
    const { data: other } = await wA.client.from("worker_profiles").select("user_id, headline, bio").eq("user_id", wB.id);
    expect(other ?? []).toEqual([]);
    const { data: updated } = await wA.client.from("worker_profiles").update({ headline: "pwned", bio: "stolen", is_searchable: true }).eq("user_id", wB.id).select();
    expect(updated ?? []).toEqual([]);
    const { rows } = await pool.query("select headline from public.worker_profiles where user_id=$1", [wB.id]);
    expect(rows[0].headline).not.toBe("pwned");
  });

  it("an employer cannot read a worker profile row, searchable or not", async () => {
    expect((await employer.client.from("worker_profiles").select("user_id").eq("user_id", wA.id)).data).toEqual([]);
    await pool.query(
      `insert into public.organizations (name, org_type, created_by)
       values ('RLS Employer Org', 'corporate', $1)
       on conflict do nothing`,
      [employer.id],
    );
    await pool.query(
      `insert into public.organization_members (organization_id, user_id, role)
       select id, $1, 'owner_admin' from public.organizations where created_by=$1
       on conflict do nothing`,
      [employer.id],
    );
    await pool.query(
      "update public.worker_profiles set is_searchable=true, city='Oakland', county='Alameda', postal_code='94612', bio='private bio', headline='Night posts' where user_id=$1",
      [wA.id],
    );
    expect((await employer.client.from("worker_profiles").select("city, postal_code, bio, headline").eq("user_id", wA.id)).data ?? []).toEqual([]);
    const card = await employer.client.from("worker_search_cards").select("city, headline").eq("user_id", wA.id).single();
    expect(card.data).toEqual({ city: "Oakland", headline: "Night posts" });
    const hidden = await pool.query(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='worker_search_cards'
         and column_name in ('bio','postal_code','security_experience','le_experience_summary','approx_lat','approx_lng')`,
    );
    expect(hidden.rows).toEqual([]);
    await pool.query("update public.worker_profiles set is_searchable=false where user_id=$1", [wA.id]);
    expect((await employer.client.from("worker_search_cards").select("user_id").eq("user_id", wA.id)).data ?? []).toEqual([]);
  });

  it("a worker cannot read or write another worker's availability", async () => {
    const { data: row, error } = await wA.client.from("worker_availability").insert({ worker_id: wA.id, weekday: 1, start_time: "09:00", end_time: "17:00" }).select("id").single();
    expect(error).toBeNull();
    expect((await wB.client.from("worker_availability").select("id").eq("worker_id", wA.id)).data).toEqual([]);
    expect((await wB.client.from("worker_availability").update({ note: "pwned" }).eq("id", row!.id).select()).data ?? []).toEqual([]);
    expect((await wB.client.from("worker_availability").insert({ worker_id: wA.id, weekday: 2, start_time: "09:00", end_time: "12:00" })).error).not.toBeNull();
    expect((await wB.client.from("worker_availability").delete().eq("id", row!.id).select()).data ?? []).toEqual([]);
  });
});

describe("definer RPCs cannot escalate roles", () => {
  it("my_roles is read-only and returns only the caller's roles", async () => {
    const before = await pool.query("select account_type, platform_role, status from public.profiles where id=$1", [wA.id]);
    const roles = await wA.client.rpc("my_roles");
    expect(roles.error).toBeNull();
    expect(roles.data).toEqual(["worker"]);
    const after = await pool.query("select account_type, platform_role, status from public.profiles where id=$1", [wA.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const extra = await wA.client.rpc("my_roles", { p_platform_role: "super_admin" } as never);
    expect(extra.data ?? []).not.toContain("super_admin");
    const src = await pool.query("select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='my_roles'");
    expect(src.rows[0].prosrc.toLowerCase()).not.toMatch(/\b(insert|update|delete)\b/);
  });

  it("select_account_type cannot grant staff or change platform_role", async () => {
    expect((await fresh.client.rpc("select_account_type", { p_account_type: "staff" })).error?.code).toBe("22023");
    expect((await fresh.client.rpc("select_account_type", { p_account_type: "super_admin" })).error).not.toBeNull();
    let row = (await pool.query("select account_type::text, platform_role::text from public.profiles where id=$1", [fresh.id])).rows[0];
    expect(row).toEqual({ account_type: null, platform_role: "user" });
    expect((await fresh.client.rpc("select_account_type", { p_account_type: "worker" })).error).toBeNull();
    row = (await pool.query("select account_type::text, platform_role::text from public.profiles where id=$1", [fresh.id])).rows[0];
    expect(row).toEqual({ account_type: "worker", platform_role: "user" });
    expect((await fresh.client.rpc("my_roles")).data).toEqual(["worker"]);
  });

  it("record_auth_event cannot spoof the actor or run SQL from the user agent", async () => {
    const payload = "'); update public.profiles set platform_role='super_admin' where true; --";
    expect((await wA.client.rpc("record_auth_event", { p_action: "auth.login", p_user_agent: payload })).error).toBeNull();
    const profile = await pool.query("select platform_role::text from public.profiles where id=$1", [wA.id]);
    expect(profile.rows[0].platform_role).toBe("user");
    const other = await pool.query("select platform_role::text from public.profiles where id=$1", [wB.id]);
    expect(other.rows[0].platform_role).toBe("user");
    const event = await pool.query("select actor_id, user_agent from public.audit_logs where actor_id=$1 and action='auth.login' order by id desc limit 1", [wA.id]);
    expect(event.rows[0].actor_id).toBe(wA.id);
    expect(event.rows[0].user_agent).toBe(payload);
    expect((await anonClient().rpc("my_roles")).error).not.toBeNull();
    expect((await anonClient().rpc("record_auth_event", { p_action: "auth.login" })).error).not.toBeNull();
    expect((await anonClient().rpc("select_account_type", { p_account_type: "worker" })).error).not.toBeNull();
  });
});

describe("credentials and documents", () => {
  it("a worker cannot read or modify another worker's credential or document", async () => {
    const future = await pacificDate(400);
    const issued = await pacificDate(-30);
    const path = `${wA.id}/${randomUUID()}.pdf`;
    expect((await wA.client.storage.from("credential-documents").upload(path, pdf)).error).toBeNull();
    const inserted = await wA.client
      .from("credentials")
      .insert({
        worker_id: wA.id,
        credential_type_id: typeId,
        credential_number: "G1234567",
        issuer: "CA BSIS",
        issued_on: issued,
        expires_on: future,
        document_path: path,
        status: "unverified",
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    credA = inserted.data!.id;

    expect((await wB.client.from("credentials").select("id, credential_number").eq("id", credA)).data).toEqual([]);
    expect((await employer.client.from("credentials").select("id").eq("id", credA)).data).toEqual([]);
    expect((await wB.client.from("credentials").update({ credential_number: "stolen", issuer: "nope" }).eq("id", credA).select()).data ?? []).toEqual([]);
    expect((await wB.client.storage.from("credential-documents").download(path)).error).not.toBeNull();
    expect((await wB.client.storage.from("credential-documents").upload(`${wA.id}/${randomUUID()}.pdf`, pdf)).error).not.toBeNull();
    const still = await pool.query("select credential_number from public.credentials where id=$1", [credA]);
    expect(still.rows[0].credential_number).toBe("G1234567");
  });

  it("rejects a document path outside the owner's folder", async () => {
    const foreign = `${wB.id}/${randomUUID()}.pdf`;
    expect((await wA.client.from("credentials").update({ document_path: foreign }).eq("id", credA)).error?.code).toBe("42501");
  });

  it("a worker can submit unverified -> pending and cannot self-verify", async () => {
    expect((await wA.client.from("credentials").insert({ worker_id: wA.id, credential_type_id: typeId, status: "verified" })).error).not.toBeNull();
    expect((await wA.client.from("credentials").update({ status: "verified" }).eq("id", credA)).error?.code).toBe("42501");
    expect((await wA.client.from("credential_verifications").insert({ credential_id: credA, result_status: "verified", method: "document_review", source_reference: "forged", verified_by: wA.id })).error).not.toBeNull();
    expect((await wB.client.rpc("submit_credential", { p_credential_id: credA })).error?.code).toBe("42501");
    expect((await wA.client.rpc("review_credential", { p_credential_id: credA, p_result: "verified", p_method: "document_review", p_source_reference: "self" })).error?.code).toBe("42501");
    expect((await wA.client.rpc("submit_credential", { p_credential_id: credA })).error).toBeNull();
    const status = await pool.query("select status::text from public.credentials where id=$1", [credA]);
    expect(status.rows[0].status).toBe("pending");
    expect((await wA.client.rpc("submit_credential", { p_credential_id: credA })).error?.code).toBe("42501");
    expect((await wA.client.from("credentials").update({ credential_number: "CHANGED" }).eq("id", credA)).error?.code).toBe("42501");
  });

  it("only a moderator review writes verified, with an audit row and no external lookup", async () => {
    expect((await mod.client.from("credentials").update({ status: "verified" }).eq("id", credA)).error?.code).toBe("42501");
    expect((await mod.client.from("credential_verifications").insert({ credential_id: credA, result_status: "verified", method: "document_review", source_reference: "direct", verified_by: mod.id })).error).not.toBeNull();
    expect((await mod.client.rpc("review_credential", { p_credential_id: credA, p_result: "verified", p_method: "document_review", p_source_reference: "" })).error).not.toBeNull();
    const reviewed = await mod.client.rpc("review_credential", {
      p_credential_id: credA,
      p_result: "verified",
      p_method: "document_review",
      p_source_reference: "Reviewed uploaded guard card",
      p_notes: "Name and number match the upload",
    });
    expect(reviewed.error).toBeNull();
    const row = await pool.query("select status::text, last_verification_id from public.credentials where id=$1", [credA]);
    expect(row.rows[0].status).toBe("verified");
    const verification = await pool.query("select result_status::text, verified_by, method from public.credential_verifications where id=$1", [row.rows[0].last_verification_id]);
    expect(verification.rows[0]).toEqual({ result_status: "verified", verified_by: mod.id, method: "document_review" });
    const audit = await pool.query("select actor_id, action, after_data->>'status' as status from public.audit_logs where entity_id=$1 and action='credential.review'", [credA]);
    expect(audit.rows[0]).toEqual({ actor_id: mod.id, action: "credential.review", status: "verified" });
    expect(JSON.stringify(audit.rows[0])).not.toContain("G1234567");
    const note = await wA.client.from("notifications").select("event_type").eq("event_type", "credential_verified");
    expect(note.data?.length).toBeGreaterThan(0);
    expect((await wB.client.from("notifications").select("id").eq("event_type", "credential_verified")).data).toEqual([]);
    expect((await mod.client.rpc("review_credential", { p_credential_id: credA, p_result: "rejected", p_method: "document_review", p_notes: "again" })).error).not.toBeNull();
  });

  it("anon cannot execute review, submit, or the expiry sweep", async () => {
    for (const fn of ["submit_credential", "review_credential", "mark_expired_credentials"]) {
      const { rows } = await pool.query("select has_function_privilege('anon', p.oid, 'execute') as ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1", [fn]);
      expect(rows[0]?.ok).toBe(false);
    }
    const authSweep = await pool.query("select has_function_privilege('authenticated', p.oid, 'execute') as ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='mark_expired_credentials'");
    expect(authSweep.rows[0].ok).toBe(false);
    expect((await wA.client.rpc("mark_expired_credentials")).error).not.toBeNull();
  });
});

describe("expiration", () => {
  it("computes expiring-soon and expired, then the sweep marks past-due rows and notifies in-app only", async () => {
    const soon = await pacificDate(10);
    const yesterday = await pacificDate(-1);
    expect((await pool.query("select public.credential_time_state('verified'::public.verification_status, $1::date)", [soon])).rows[0].credential_time_state).toBe("expiring_soon");
    expect((await pool.query("select public.credential_time_state('verified'::public.verification_status, $1::date)", [yesterday])).rows[0].credential_time_state).toBe("expired");

    const issued = await pacificDate(-10);
    const pending = await wB.client
      .from("credentials")
      .insert({
        worker_id: wB.id,
        credential_type_id: typeId,
        credential_number: "B0001111",
        issuer: "CA BSIS",
        issued_on: issued,
        expires_on: yesterday,
        status: "unverified",
      })
      .select("id")
      .single();
    expect(pending.error).toBeNull();
    const path = `${wB.id}/${randomUUID()}.pdf`;
    expect((await wB.client.storage.from("credential-documents").upload(path, pdf)).error).toBeNull();
    expect((await wB.client.from("credentials").update({ document_path: path }).eq("id", pending.data!.id)).error).toBeNull();
    expect((await wB.client.rpc("submit_credential", { p_credential_id: pending.data!.id })).error).toBeNull();

    const expiringId = credA;
    await pool.query("alter table public.credentials disable trigger credentials_guard_write");
    try {
      await pool.query("update public.credentials set expires_on=$2 where id=$1", [expiringId, soon]);
    } finally {
      await pool.query("alter table public.credentials enable trigger credentials_guard_write");
    }

    const first = await admin.rpc("mark_expired_credentials");
    expect(first.error).toBeNull();
    expect(first.data).toBeGreaterThanOrEqual(1);
    const pendingStatus = await pool.query("select status::text from public.credentials where id=$1", [pending.data!.id]);
    expect(pendingStatus.rows[0].status).toBe("expired");
    const stillVerified = await pool.query("select status::text from public.credentials where id=$1", [expiringId]);
    expect(stillVerified.rows[0].status).toBe("verified");

    const expiredNote = await wB.client.from("notifications").select("id, event_type").eq("event_type", "credential_expired");
    expect(expiredNote.data?.length).toBe(1);
    const soonNote = await wA.client.from("notifications").select("id").eq("event_type", "credential_expiring");
    expect(soonNote.data?.length).toBe(1);
    const deliveries = await pool.query("select count(*)::int n from public.notification_deliveries");
    expect(deliveries.rows[0].n).toBe(0);

    const second = await admin.rpc("mark_expired_credentials");
    expect(second.data).toBe(0);
    const notes = await pool.query("select count(*)::int n from public.notifications where event_type in ('credential_expired','credential_expiring') and user_id = any($1)", [[wA.id, wB.id]]);
    expect(notes.rows[0].n).toBe(2);

    expect((await wB.client.from("credentials").update({ status: "verified", expires_on: soon }).eq("id", pending.data!.id)).error?.code).toBe("42501");
    expect(await sqlError(wB.id, "update public.credentials set status='verified' where id=$1", [pending.data!.id])).toBe("42501");
  });
});
