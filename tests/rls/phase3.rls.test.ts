import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, asUser, cleanup, createUser, pool, type TestUser } from "./helpers";

let ownerA: TestUser, ownerB: TestUser, recruiter: TestUser, manager: TestUser, worker: TestUser, outsider: TestUser, mod: TestUser, fresh: TestUser;
let orgA: string, orgB: string, jobA: string, jobB: string, credId: string;
const tables = ["applications", "job_requirements", "jobs", "organization_members", "worker_availability", "worker_profiles"];

async function accept(org: string, email: string, role: string, user: TestUser) {
  const invite = await ownerA.client.rpc("create_organization_invite", { p_org: org, p_email: email, p_role: role });
  expect(invite.error, invite.error?.message).toBeNull();
  const accepted = await user.client.rpc("accept_organization_invite", { p_token: invite.data });
  expect(accepted.error, accepted.error?.message).toBeNull();
}

beforeAll(async () => {
  [ownerA, ownerB, recruiter, manager, worker, outsider, mod, fresh] = await Promise.all(
    ["p3a", "p3b", "p3r", "p3m", "p3w", "p3o", "p3mod", "p3f"].map((label) => createUser(label)),
  );
  for (const user of [ownerA, ownerB, recruiter, manager, outsider]) {
    expect((await user.client.rpc("select_account_type", { p_account_type: "employer" })).error).toBeNull();
  }
  expect((await worker.client.rpc("select_account_type", { p_account_type: "worker" })).error).toBeNull();
  await pool.query("update public.profiles set account_type='staff', platform_role='moderator' where id=$1", [mod.id]);

  const createdA = await ownerA.client.rpc("create_organization", {
    p_name: "Harbor PPO",
    p_org_type: "ppo",
    p_contact_email: ownerA.email,
    p_bsis_license_type: "PPO",
    p_bsis_license_number: "PPO 12345-A",
    p_service_counties: ["Alameda"],
  });
  expect(createdA.error, createdA.error?.message).toBeNull();
  orgA = createdA.data;
  const createdB = await ownerB.client.rpc("create_organization", {
    p_name: "Other Org",
    p_org_type: "retail",
    p_contact_email: ownerB.email,
  });
  expect(createdB.error, createdB.error?.message).toBeNull();
  orgB = createdB.data;
  await accept(orgA, recruiter.email, "recruiter_dispatcher", recruiter);
  await accept(orgA, manager.email, "manager", manager);

  const draft = {
    title: "Lobby contract",
    description: "Watch the lobby entrance overnight.",
    job_type: "contract",
    category: "unarmed_security",
    pay_type: "hourly",
    pay_min_cents: 3200,
    city: "Oakland",
    workers_needed: 1,
    status: "draft",
  };
  const inserted = await ownerA.client.from("jobs").insert({ ...draft, organization_id: orgA, created_by: ownerA.id }).select("id").single();
  expect(inserted.error, inserted.error?.message).toBeNull();
  jobA = inserted.data!.id;
  const address = await ownerA.client.from("job_private_locations").insert({ job_id: jobA, site_address: "100 Market Street" });
  expect(address.error, address.error?.message).toBeNull();
  const other = await ownerB.client.from("jobs").insert({ ...draft, title: "Other draft", organization_id: orgB, created_by: ownerB.id }).select("id").single();
  expect(other.error, other.error?.message).toBeNull();
  jobB = other.data!.id;
  expect((await ownerB.client.from("job_private_locations").insert({ job_id: jobB, site_address: "500 Private Ave" })).error).toBeNull();

  const typeId = (await pool.query("select id from public.credential_types where code='ca_guard_registration'")).rows[0].id;
  const credential = await worker.client.from("credentials").insert({
    worker_id: worker.id,
    credential_type_id: typeId,
    credential_number: "G1234567",
    issuer: "CA BSIS",
    issued_on: "2024-01-15",
    expires_on: "2028-01-15",
    document_path: `${worker.id}/${randomUUID()}.pdf`,
  }).select("id").single();
  expect(credential.error, credential.error?.message).toBeNull();
  credId = credential.data!.id;
});

afterAll(async () => {
  await pool.query("delete from public.organizations where id = any($1::uuid[])", [[orgA, orgB].filter(Boolean)]);
  await cleanup([ownerA, ownerB, recruiter, manager, worker, outsider, mod, fresh].filter(Boolean));
  await pool.end();
});

describe("credential and account RPCs", () => {
  it("refuses review_credential from a worker and from an employer", async () => {
    expect((await worker.client.rpc("submit_credential", { p_credential_id: credId })).error).toBeNull();
    const before = await pool.query("select status::text from public.credentials where id=$1", [credId]);
    expect(before.rows[0].status).toBe("pending");
    expect((await worker.client.rpc("review_credential", {
      p_credential_id: credId,
      p_result: "verified",
      p_method: "document_review",
      p_source_reference: "self",
    })).error?.code).toBe("42501");
    expect((await ownerA.client.rpc("review_credential", {
      p_credential_id: credId,
      p_result: "verified",
      p_method: "document_review",
      p_source_reference: "employer",
    })).error?.code).toBe("42501");
    const after = await pool.query("select status::text from public.credentials where id=$1", [credId]);
    expect(after.rows[0].status).toBe("pending");
  });

  it("refuses submit_credential for someone else's credential", async () => {
    const typeId = (await pool.query("select id from public.credential_types where code='first_aid'")).rows[0].id;
    const other = await worker.client.from("credentials").insert({
      worker_id: worker.id,
      credential_type_id: typeId,
      credential_number: "FA-1",
      issuer: "Class",
      issued_on: "2024-02-01",
      expires_on: "2027-02-01",
      document_path: `${worker.id}/${randomUUID()}.pdf`,
    }).select("id").single();
    expect(other.error).toBeNull();
    expect((await ownerA.client.rpc("submit_credential", { p_credential_id: other.data!.id })).error?.code).toBe("42501");
    expect((await recruiter.client.rpc("submit_credential", { p_credential_id: other.data!.id })).error?.code).toBe("42501");
    const status = await pool.query("select status::text from public.credentials where id=$1", [other.data!.id]);
    expect(status.rows[0].status).toBe("unverified");
  });

  it("select_account_type cannot grant staff, switch later, or touch another user", async () => {
    const args = await pool.query(
      `select p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='select_account_type'`,
    );
    expect(args.rows[0].proargnames).toEqual(["p_account_type"]);
    expect((await fresh.client.rpc("select_account_type", { p_account_type: "staff" })).error?.code).toBe("22023");
    expect((await fresh.client.rpc("select_account_type", { p_account_type: "worker" })).error).toBeNull();
    expect((await fresh.client.rpc("select_account_type", { p_account_type: "employer" })).error?.code).toBe("42501");
    const other = await pool.query("select account_type::text from public.profiles where id=$1", [ownerA.id]);
    expect(other.rows[0].account_type).toBe("employer");
    const forged = await fresh.client.from("profiles").update({ account_type: "staff", platform_role: "super_admin" }).eq("id", ownerA.id).select();
    expect(forged.data ?? []).toEqual([]);
    const still = await pool.query("select account_type::text, platform_role::text from public.profiles where id=$1", [ownerA.id]);
    expect(still.rows[0]).toEqual({ account_type: "employer", platform_role: "user" });
  });

  it("does not let anon call the new organization or job RPCs", async () => {
    const anon = anonClient();
    expect((await anon.rpc("create_organization", { p_name: "Nope", p_org_type: "other" })).error).not.toBeNull();
    expect((await anon.rpc("review_organization", { p_org: orgA, p_result: "verified", p_notes: "forged note" })).error).not.toBeNull();
    expect((await anon.rpc("review_credential", { p_credential_id: credId, p_result: "verified", p_method: "document_review", p_source_reference: "x" })).error).not.toBeNull();
    expect((await anon.rpc("transition_job", { p_job_id: jobA, p_target: "published" })).error).not.toBeNull();
  });
});

describe("organization isolation", () => {
  it("keeps another organization's rows, jobs, members, invites, and site address hidden", async () => {
    expect((await ownerB.client.from("organizations").select("id").eq("id", orgA)).data).toEqual([]);
    expect((await ownerB.client.from("organizations").update({ name: "stolen", description: "no" }).eq("id", orgA).select()).data ?? []).toEqual([]);
    expect((await ownerB.client.from("jobs").select("id, city").eq("id", jobA)).data).toEqual([]);
    expect((await ownerB.client.from("jobs").update({ title: "stolen title" }).eq("id", jobA).select()).data ?? []).toEqual([]);
    expect((await ownerB.client.from("organization_members").select("user_id").eq("organization_id", orgA)).data).toEqual([]);
    expect((await ownerB.client.from("organization_invites").select("id, email").eq("organization_id", orgA)).data).toEqual([]);
    expect((await ownerB.client.from("job_private_locations").select("site_address").eq("job_id", jobA)).data).toEqual([]);
    const name = await pool.query("select name from public.organizations where id=$1", [orgA]);
    expect(name.rows[0].name).toBe("Harbor PPO");
  });

  it("shows the license only to members, exactly as submitted", async () => {
    expect((await outsider.client.from("organizations").select("bsis_license_number").eq("id", orgA)).error).not.toBeNull();
    expect((await ownerA.client.from("organizations").select("bsis_license_number, bsis_license_type").eq("id", orgA)).error).not.toBeNull();
    expect((await ownerA.client.from("organizations").update({ bsis_license_number: "CHANGED", org_type: "retail" }).eq("id", orgA)).error?.code).toBe("42501");
    expect((await outsider.client.rpc("organization_license", { p_org: orgA })).error?.code).toBe("42501");
    const shown = await ownerA.client.rpc("organization_license", { p_org: orgA });
    expect(shown.data).toEqual([{ license_type: "PPO", license_number: "PPO 12345-A" }]);
    const privileges = await pool.query(
      `select has_column_privilege('authenticated', 'public.organizations', 'bsis_license_number', 'SELECT') as read_license,
              has_column_privilege('authenticated', 'public.organizations', 'bsis_license_number', 'UPDATE') as write_license,
              has_column_privilege('authenticated', 'public.organizations', 'org_type', 'UPDATE') as write_type`,
    );
    expect(privileges.rows[0]).toEqual({ read_license: false, write_license: false, write_type: false });
  });

  it("blocks client membership writes and protects the last owner", async () => {
    expect((await ownerA.client.from("organization_members").insert({ organization_id: orgA, user_id: outsider.id, role: "manager" })).error).not.toBeNull();
    const direct = await ownerA.client.from("organization_members").update({ role: "owner_admin" }).eq("organization_id", orgA).eq("user_id", recruiter.id).select();
    expect(direct.data ?? []).toEqual([]);
    await ownerA.client.from("organization_members").delete().eq("organization_id", orgA).eq("user_id", recruiter.id);
    const role = await pool.query("select role::text from public.organization_members where organization_id=$1 and user_id=$2", [orgA, recruiter.id]);
    expect(role.rows[0].role).toBe("recruiter_dispatcher");

    expect((await recruiter.client.rpc("change_org_member_role", { p_org: orgA, p_user: manager.id, p_role: "owner_admin" })).error?.code).toBe("42501");
    expect((await manager.client.rpc("create_organization_invite", { p_org: orgA, p_email: "extra@example.test", p_role: "recruiter_dispatcher" })).error?.code).toBe("42501");
    expect((await ownerA.client.rpc("change_org_member_role", { p_org: orgA, p_user: ownerA.id, p_role: "manager" })).error?.code).toBe("23514");
    expect((await ownerA.client.rpc("remove_org_member", { p_org: orgA, p_user: ownerA.id })).error?.code).toBe("23514");

    await expect(pool.query("delete from public.organization_members where organization_id=$1 and user_id=$2", [orgA, ownerA.id])).rejects.toThrow(/last owner/);
    await asUser(ownerA.id, async (client) => {
      await client.query("select set_config('app.org_delete', '1', true)");
      const removed = await client.query("delete from public.organization_members where organization_id=$1 and user_id=$2", [orgA, ownerA.id]);
      expect(removed.rowCount).toBe(0);
    });
    const owners = await pool.query("select count(*)::int n from public.organization_members where organization_id=$1 and user_id=$2", [orgA, ownerA.id]);
    expect(owners.rows[0].n).toBe(1);
  });

  it("still lets deleting the organization remove the last owner", async () => {
    const created = await outsider.client.rpc("create_organization", { p_name: "Temporary Org", p_org_type: "other" });
    expect(created.error).toBeNull();
    await pool.query("delete from public.organizations where id=$1", [created.data]);
    const left = await pool.query("select count(*)::int n from public.organization_members where organization_id=$1", [created.data]);
    expect(left.rows[0].n).toBe(0);
  });

  it("does not let an employer or worker self-verify an organization", async () => {
    expect((await ownerA.client.from("organizations").update({ verification_status: "verified" }).eq("id", orgA)).error?.code).toBe("42501");
    expect((await ownerA.client.rpc("review_organization", { p_org: orgA, p_result: "verified", p_notes: "I approve myself." })).error?.code).toBe("42501");
    expect((await worker.client.rpc("review_organization", { p_org: orgA, p_result: "verified", p_notes: "I approve this." })).error?.code).toBe("42501");
    const status = await pool.query("select verification_status::text from public.organizations where id=$1", [orgA]);
    expect(status.rows[0].verification_status).toBe("unverified");
  });
});

describe("jobs", () => {
  it("lets a recruiter create a draft and hides drafts from non-members", async () => {
    const inserted = await recruiter.client.from("jobs").insert({
      organization_id: orgA,
      created_by: recruiter.id,
      title: "Recruiter draft",
      description: "A draft only members should see.",
      job_type: "contract",
      category: "event_security",
      pay_type: "flat",
      pay_min_cents: 50000,
      city: "Oakland",
      status: "draft",
    }).select("id").single();
    expect(inserted.error, inserted.error?.message).toBeNull();
    expect((await outsider.client.from("jobs").select("id").eq("id", inserted.data!.id)).data).toEqual([]);
    expect((await worker.client.from("jobs").insert({
      organization_id: orgA,
      created_by: worker.id,
      title: "Worker job",
      description: "Workers cannot post this.",
      job_type: "contract",
      category: "unarmed_security",
      pay_type: "hourly",
      pay_min_cents: 2000,
      city: "Oakland",
      status: "draft",
    })).error).not.toBeNull();
  });

  it("coerces an unverified publish, then publishes only after staff verification", async () => {
    const incomplete = await ownerA.client.from("jobs").insert({
      organization_id: orgA,
      created_by: ownerA.id,
      title: "Thin",
      description: "Too short",
      job_type: "contract",
      category: "unarmed_security",
      pay_type: "hourly",
      status: "draft",
    }).select("id").single();
    expect(incomplete.error).toBeNull();
    expect((await ownerA.client.rpc("transition_job", { p_job_id: incomplete.data!.id, p_target: "pending_review" })).error?.message).toMatch(/incomplete/);
    expect((await ownerA.client.rpc("transition_job", { p_job_id: jobA, p_target: "published" })).data).toBe("pending_review");
    expect((await ownerA.client.from("jobs").update({ status: "published" }).eq("id", jobA)).error?.code).toBe("42501");
    await asUser(ownerA.id, async (client) => {
      await client.query("select set_config('app.job_status_transition', '1', true)");
      await expect(client.query("update public.jobs set status = 'published' where id = $1", [jobA])).rejects.toThrow(/permission denied/);
    });
    expect((await ownerA.client.from("jobs").insert({
      organization_id: orgA,
      created_by: ownerA.id,
      title: "Pinned shift",
      description: "Coordinates must not be client-writable.",
      job_type: "contract",
      category: "unarmed_security",
      pay_type: "hourly",
      pay_min_cents: 1000,
      city: "Oakland",
      status: "draft",
      site_lat: 37.8,
      site_lng: -122.27,
    })).error).not.toBeNull();
    expect((await ownerA.client.from("jobs").insert({
      organization_id: orgA,
      created_by: ownerA.id,
      title: "Street leak",
      description: "This should not store a street on the job row.",
      job_type: "contract",
      category: "unarmed_security",
      pay_type: "hourly",
      pay_min_cents: 1000,
      city: "Oakland",
      status: "draft",
      site_address_private: "100 Market Street",
    })).error).not.toBeNull();

    expect((await ownerA.client.rpc("submit_organization_verification", { p_org: orgA })).error).toBeNull();
    expect((await mod.client.rpc("review_organization", { p_org: orgA, p_result: "verified", p_notes: "Read the submitted license number." })).error).toBeNull();
    expect((await ownerA.client.rpc("transition_job", { p_job_id: jobA, p_target: "published" })).data).toBe("published");

    const anonCity = await anonClient().from("jobs").select("city").eq("id", jobA);
    expect(anonCity.data).toEqual([{ city: "Oakland" }]);
    expect((await anonClient().from("jobs").select("site_address_private, site_lat, site_lng").eq("id", jobA)).error).not.toBeNull();
    expect((await ownerA.client.from("jobs").select("site_address_private").eq("id", jobA)).error).not.toBeNull();
    const hiddenColumns = await pool.query(
      `select has_column_privilege('authenticated', 'public.jobs', 'site_address_private', 'SELECT') as read_address,
              has_column_privilege('authenticated', 'public.jobs', 'site_lat', 'INSERT') as write_lat,
              has_column_privilege('anon', 'public.jobs', 'site_address_private', 'SELECT') as anon_address`,
    );
    expect(hiddenColumns.rows[0]).toEqual({ read_address: false, write_lat: false, anon_address: false });
    expect((await anonClient().from("job_private_locations").select("site_address").eq("job_id", jobA)).error).not.toBeNull();
    expect((await outsider.client.from("jobs").select("city").eq("id", jobA)).data).toEqual([{ city: "Oakland" }]);
    expect((await outsider.client.from("job_private_locations").select("site_address").eq("job_id", jobA)).data).toEqual([]);
    const license = await outsider.client.rpc("organization_license", { p_org: orgA });
    expect(license.error?.code).toBe("42501");
  });

  it("keeps worker search cards read-only and free of private columns", async () => {
    expect((await ownerA.client.from("worker_search_cards").insert({ user_id: worker.id, display_name: "Forged" })).error).not.toBeNull();
    expect((await ownerA.client.from("worker_search_cards").update({ headline: "Forged" }).eq("user_id", worker.id).select()).data ?? []).toEqual([]);
    const columns = await pool.query(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='worker_search_cards'
         and column_name ~* 'bio|security_experience|le_|postal|lat|lng|phone|email'`,
    );
    expect(columns.rows).toEqual([]);
    const source = await pool.query("select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='sync_worker_search_card'");
    expect(source.rows[0].prosrc).not.toMatch(/bio|security_experience|le_experience|postal_code|approx_lat/);
  });
});

describe("policy consolidation", () => {
  it("leaves one permissive select policy per role on the six overlapping tables", async () => {
    const { rows } = await pool.query(
      `select c.relname, pol.polname
       from pg_policy pol
       join pg_class c on c.oid = pol.polrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = any($1::text[])
         and pol.polpermissive
         and pol.polcmd in ('r', '*')
         and (
           cardinality(pol.polroles) = 0
           or exists (
             select 1 from pg_roles r
             where r.rolname = 'authenticated' and r.oid = any (pol.polroles)
           )
         )`,
      [tables],
    );
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.relname, (counts.get(row.relname) ?? 0) + 1);
    for (const table of tables) expect(counts.get(table) ?? 0, table).toBe(1);
    const dropped = await pool.query(
      `select pol.polname from pg_policy pol
       join pg_class c on c.oid = pol.polrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and pol.polname = any($1::text[])`,
      [["wp_employer_read", "om_admin_manage", "jobs_public_read", "jobs_org_read", "jr_org_write", "app_worker_read", "app_org_read", "wa_owner_all", "wa_staff_read"]],
    );
    expect(dropped.rows).toEqual([]);
  });

  it("does not expose invite token hashes", async () => {
    expect((await ownerA.client.from("organization_invites").select("token_hash").eq("organization_id", orgA)).error).not.toBeNull();
    const tokenPrivilege = await pool.query("select has_column_privilege('authenticated', 'public.organization_invites', 'token_hash', 'SELECT') as ok");
    expect(tokenPrivilege.rows[0].ok).toBe(false);
    const readable = await ownerA.client.from("organization_invites").select("id, email").eq("organization_id", orgA);
    expect(readable.error).toBeNull();
  });
});
