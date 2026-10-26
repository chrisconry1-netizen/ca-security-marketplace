import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, cleanup, createUser, pool, sqlError, type TestUser } from "./helpers";

let worker: TestUser;
let otherWorker: TestUser;
let employer: TestUser;
let otherEmployer: TestUser;
let moderator: TestUser;
let orgId: string;
let otherOrgId: string;
let openJob: string;
let withdrawJob: string;
let rejectJob: string;
let draftJob: string;
let armedJob: string;
let expiredJob: string;
let applicationId: string;
let guardType: string;
let firearmType: string;

const future = "2028-01-15";
const issued = "2024-01-15";
const pdf = new Blob([Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")], { type: "application/pdf" });

async function saveDraft(
  client: TestUser["client"],
  organizationId: string,
  title: string,
  patch: Record<string, unknown> = {},
) {
  const { data, error } = await client.rpc("save_job_draft", {
    p_organization_id: organizationId,
    p_job_id: null,
    p_title: title,
    p_description: "Lobby coverage for the test shift.",
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
    p_required_codes: ["ca_guard_registration"],
    p_optional_codes: [],
    ...patch,
  });
  if (error || !data) throw new Error(error?.message ?? "save_job_draft failed");
  return data as string;
}

async function addCredential(user: TestUser, typeId: string, number: string) {
  const path = `${user.id}/${randomUUID()}.pdf`;
  const uploaded = await user.client.storage.from("credential-documents").upload(path, pdf);
  if (uploaded.error) throw new Error(uploaded.error.message);
  const inserted = await user.client
    .from("credentials")
    .insert({
      worker_id: user.id,
      credential_type_id: typeId,
      credential_number: number,
      issuer: "CA BSIS",
      issued_on: issued,
      expires_on: future,
      document_path: path,
      status: "unverified",
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "credential insert failed");
  const submitted = await user.client.rpc("submit_credential", { p_credential_id: inserted.data.id });
  if (submitted.error) throw new Error(submitted.error.message);
  const reviewed = await moderator.client.rpc("review_credential", {
    p_credential_id: inserted.data.id,
    p_result: "verified",
    p_method: "document_review",
    p_source_reference: "Reviewed the uploaded card",
  });
  if (reviewed.error) throw new Error(reviewed.error.message);
  return inserted.data.id as string;
}

beforeAll(async () => {
  [worker, otherWorker, employer, otherEmployer, moderator] = await Promise.all(
    ["p4w", "p4w2", "p4e", "p4e2", "p4m"].map((label) => createUser(label, { display_name: label })),
  );
  for (const user of [worker, otherWorker]) {
    const selected = await user.client.rpc("select_account_type", { p_account_type: "worker" });
    if (selected.error) throw new Error(selected.error.message);
  }
  for (const user of [employer, otherEmployer]) {
    const selected = await user.client.rpc("select_account_type", { p_account_type: "employer" });
    if (selected.error) throw new Error(selected.error.message);
  }
  await pool.query("update public.profiles set account_type='staff', platform_role='moderator' where id=$1", [moderator.id]);
  const types = await pool.query("select id, code from public.credential_types where code in ('ca_guard_registration','ca_exposed_firearm_permit')");
  guardType = types.rows.find((row) => row.code === "ca_guard_registration").id;
  firearmType = types.rows.find((row) => row.code === "ca_exposed_firearm_permit").id;

  const created = await employer.client.rpc("create_organization", { p_name: `RLS Org ${worker.id.slice(0, 8)}`, p_org_type: "ppo" });
  if (created.error || !created.data) throw new Error(created.error?.message ?? "create org failed");
  orgId = created.data as string;
  const other = await otherEmployer.client.rpc("create_organization", { p_name: `Other Org ${worker.id.slice(0, 8)}`, p_org_type: "corporate" });
  if (other.error || !other.data) throw new Error(other.error?.message ?? "create other org failed");
  otherOrgId = other.data as string;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.org_verification_transition', '1', true)");
    await client.query("update public.organizations set verification_status='pending' where id=$1", [orgId]);
    await client.query(
      "update public.organizations set verification_status='verified', verified_at=now() where id=$1",
      [orgId],
    );
    await client.query("commit");
  } finally {
    client.release();
  }

  openJob = await saveDraft(employer.client, orgId, "Open lobby shift");
  withdrawJob = await saveDraft(employer.client, orgId, "Withdraw lobby shift");
  rejectJob = await saveDraft(employer.client, orgId, "Reject lobby shift");
  draftJob = await saveDraft(employer.client, orgId, "Draft lobby shift");
  armedJob = await saveDraft(employer.client, orgId, "Armed lobby shift", { p_is_armed: true, p_category: "armed_security", p_required_codes: [] });
  expiredJob = await saveDraft(employer.client, orgId, "Expired lobby shift", { p_required_codes: [] });
  for (const id of [openJob, withdrawJob, rejectJob, armedJob, expiredJob]) {
    const published = await employer.client.rpc("publish_job", { p_job_id: id });
    if (published.error) throw new Error(published.error.message);
  }
  await pool.query(
    "update public.jobs set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id=$1",
    [expiredJob],
  );
});

afterAll(async () => {
  const orgs = [orgId, otherOrgId].filter(Boolean);
  if (orgs.length) {
    await pool.query("delete from public.assignments where organization_id = any($1::uuid[])", [orgs]);
    await pool.query("delete from public.jobs where organization_id = any($1::uuid[])", [orgs]);
    await pool.query("delete from public.organizations where id = any($1::uuid[])", [orgs]);
  }
  await cleanup([worker, otherWorker, employer, otherEmployer, moderator].filter(Boolean));
  await pool.end();
});

describe("marketplace visibility", () => {
  it("keeps private site columns and unpublished rows away from anon and other workers", async () => {
    expect(await sqlError(null, "select site_address_private from public.jobs where id=$1", [openJob])).toBe("42501");
    expect(await sqlError(worker.id, "select site_lat, site_lng, site_address_private from public.jobs where id=$1", [openJob])).toBe("42501");
    const anon = anonClient();
    const published = await anon.from("jobs").select("id, title, city, status").eq("id", openJob).maybeSingle();
    expect(published.error).toBeNull();
    expect(published.data?.city).toBe("Oakland");
    expect(published.data?.status).toBe("published");
    const hidden = await anon.from("jobs").select("id").eq("id", draftJob);
    expect(hidden.data).toEqual([]);
    const search = await anon.rpc("search_jobs", { p_city: "Oakland", p_lat: 37.8044, p_lng: -122.2712, p_radius_miles: 15 });
    expect(search.error).toBeNull();
    const ids = (search.data ?? []).map((row: { id: string }) => row.id);
    expect((search.data ?? []).length).toBeGreaterThan(0);
    expect(ids).toContain(openJob);
    expect(ids).not.toContain(draftJob);
    expect(JSON.stringify(search.data ?? [])).not.toContain("400 Broadway");
    expect(Object.keys(search.data?.[0] ?? {})).not.toContain("site_address_private");
    const far = await anon.rpc("search_jobs", { p_lat: 32.7157, p_lng: -117.1611, p_radius_miles: 5 });
    expect((far.data ?? []).map((row: { id: string }) => row.id)).not.toContain(openJob);
    const point = await pool.query("select approx_lat::float8 lat, approx_lng::float8 lng, shift_period from public.jobs where id=$1", [openJob]);
    expect(point.rows[0].lat).toBe(37.81);
    expect(point.rows[0].lng).toBe(-122.27);
    expect(point.rows[0].shift_period).toBe("day");
    const privateSite = await worker.client.rpc("job_private_site", { p_job_id: openJob });
    expect(privateSite.data).toEqual([]);
    const employerSite = await employer.client.rpc("job_private_site", { p_job_id: openJob });
    expect(employerSite.data?.[0]?.site_address_private).toBe("400 Broadway");
    expect((await anon.rpc("job_private_site", { p_job_id: openJob })).error).not.toBeNull();
  });

  it("blocks direct application and assignment writes", async () => {
    expect(
      await sqlError(worker.id, "insert into public.applications (job_id, worker_id, status) values ($1, $2, 'submitted')", [openJob, worker.id]),
    ).toBe("42501");
    expect(
      await sqlError(worker.id, "update public.applications set status='shortlisted' where job_id=$1", [openJob]),
    ).toBe("42501");
    const forged = await admin.from("assignments").insert({
      job_id: openJob,
      worker_id: worker.id,
      organization_id: orgId,
      status: "confirmed",
      worker_confirmed_at: new Date().toISOString(),
      employer_confirmed_at: new Date().toISOString(),
    });
    expect(forged.error).not.toBeNull();
    expect((await worker.client.from("saved_jobs").insert({ worker_id: worker.id, job_id: draftJob })).error?.code).toBe("42501");
  });
});

describe("application state machine", () => {
  it("blocks apply until mandatory and armed credentials are verified", async () => {
    const missing = await worker.client.rpc("submit_application", { p_job_id: openJob, p_note: "too early" });
    expect(missing.error?.message).toMatch(/mandatory credential missing/);
    const armed = await worker.client.rpc("submit_application", { p_job_id: armedJob });
    expect(armed.error?.message).toMatch(/armed credential missing/);
    const closed = await worker.client.rpc("submit_application", { p_job_id: draftJob });
    expect(closed.error?.message).toMatch(/job is not open/);
    const expired = await worker.client.rpc("submit_application", { p_job_id: expiredJob });
    expect(expired.error?.message).toMatch(/job has expired/);
    await addCredential(worker, guardType, "BSIS-999111");
    const armedStill = await worker.client.rpc("submit_application", { p_job_id: armedJob });
    expect(armedStill.error?.message).toMatch(/armed credential missing/);
  });

  it("hides one worker's application from other workers and other employers", async () => {
    const submitted = await worker.client.rpc("submit_application", { p_job_id: openJob, p_note: "I can work this lobby post." });
    expect(submitted.error).toBeNull();
    applicationId = submitted.data as string;
    expect((await otherWorker.client.from("applications").select("id, cover_note").eq("id", applicationId)).data).toEqual([]);
    expect((await otherEmployer.client.from("applications").select("id").eq("job_id", openJob)).data).toEqual([]);
    expect((await otherEmployer.client.rpc("job_applicants", { p_job_id: openJob })).error?.code).toBe("42501");
    const cards = await employer.client.rpc("job_applicants", { p_job_id: openJob });
    expect(cards.error).toBeNull();
    expect(cards.data?.[0]?.cover_note).toBe("I can work this lobby post.");
    expect(JSON.stringify(cards.data)).not.toContain("BSIS-999111");
    expect(JSON.stringify(cards.data)).toContain("ca_guard_registration");
    const duplicate = await worker.client.rpc("submit_application", { p_job_id: openJob });
    expect(duplicate.error?.message).toMatch(/already applied/);
    expect((await worker.client.rpc("employer_set_application_status", { p_application_id: applicationId, p_status: "shortlisted" })).error?.code).toBe("42501");
    expect((await employer.client.rpc("accept_offer", { p_application_id: applicationId })).error).not.toBeNull();
  });

  it("enforces employer review, worker accept, and assignment creation", async () => {
    expect((await employer.client.rpc("employer_set_application_status", { p_application_id: applicationId, p_status: "accepted" })).error?.message).toMatch(/illegal application transition/);
    expect((await employer.client.rpc("employer_set_application_status", { p_application_id: applicationId, p_status: "shortlisted" })).error).toBeNull();
    expect((await employer.client.rpc("employer_set_application_status", { p_application_id: applicationId, p_status: "offered" })).error).toBeNull();
    expect((await worker.client.rpc("withdraw_application", { p_application_id: applicationId })).error).toBeNull();
    const offeredAgain = await employer.client.rpc("employer_set_application_status", { p_application_id: applicationId, p_status: "offered" });
    expect(offeredAgain.error?.message).toMatch(/illegal application transition/);
  });

  it("withdraws and rejects only through the allowed edges", async () => {
    const withdrawn = await worker.client.rpc("submit_application", { p_job_id: withdrawJob, p_note: "withdraw me" });
    expect(withdrawn.error).toBeNull();
    expect((await worker.client.rpc("withdraw_application", { p_application_id: withdrawn.data })).error).toBeNull();
    expect((await worker.client.rpc("submit_application", { p_job_id: withdrawJob })).error?.message).toMatch(/already applied/);
    expect((await employer.client.rpc("employer_set_application_status", { p_application_id: withdrawn.data, p_status: "reviewing" })).error?.message).toMatch(/illegal application transition/);

    const rejected = await otherWorker.client.rpc("submit_application", { p_job_id: rejectJob });
    expect(rejected.error?.message).toMatch(/mandatory credential missing/);
    await addCredential(otherWorker, guardType, "BSIS-888222");
    const rejectedOk = await otherWorker.client.rpc("submit_application", { p_job_id: rejectJob, p_note: "please review" });
    expect(rejectedOk.error).toBeNull();
    expect((await employer.client.rpc("employer_set_application_status", { p_application_id: rejectedOk.data, p_status: "rejected" })).error).toBeNull();
    expect((await otherWorker.client.rpc("withdraw_application", { p_application_id: rejectedOk.data })).error?.message).toMatch(/illegal application transition/);
    await expect(pool.query("update public.applications set status='reviewing' where id=$1", [rejectedOk.data])).rejects.toThrow(/illegal application transition/);
  });

  it("creates an assignment only when the worker accepts a new offer", async () => {
    const fresh = await saveDraft(employer.client, orgId, "Accept lobby shift");
    expect((await employer.client.rpc("publish_job", { p_job_id: fresh })).error).toBeNull();
    const submitted = await worker.client.rpc("submit_application", { p_job_id: fresh, p_note: "ready" });
    expect(submitted.error).toBeNull();
    expect((await worker.client.rpc("accept_offer", { p_application_id: submitted.data })).error).not.toBeNull();
    expect((await employer.client.rpc("employer_set_application_status", { p_application_id: submitted.data, p_status: "offered" })).error).toBeNull();
    const accepted = await worker.client.rpc("accept_offer", { p_application_id: submitted.data });
    expect(accepted.error).toBeNull();
    const rows = await pool.query("select id, status from public.assignments where application_id=$1", [submitted.data]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe("confirmed");
    const again = await admin.from("assignments").insert({
      job_id: fresh,
      application_id: submitted.data,
      worker_id: worker.id,
      organization_id: orgId,
      status: "confirmed",
      worker_confirmed_at: new Date().toISOString(),
      employer_confirmed_at: new Date().toISOString(),
    });
    expect(again.error).not.toBeNull();
    expect(await sqlError(worker.id, "delete from public.assignments where application_id=$1", [submitted.data])).toBeNull();
    const stillThere = await pool.query("select count(*)::int n from public.assignments where application_id=$1", [submitted.data]);
    expect(stillThere.rows[0].n).toBe(1);
    const privileged = await pool.connect();
    try {
      await privileged.query("begin");
      await privileged.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: worker.id, role: "authenticated" })]);
      await expect(privileged.query("delete from public.assignments where application_id=$1", [submitted.data])).rejects.toThrow(/assignments cannot be deleted/);
      await privileged.query("rollback");
    } finally {
      privileged.release();
    }
    const site = await worker.client.rpc("job_private_site", { p_job_id: fresh });
    expect(site.data?.[0]?.site_address_private).toBe("400 Broadway");
    expect((await otherWorker.client.rpc("job_private_site", { p_job_id: fresh })).data).toEqual([]);
    const filled = await otherWorker.client.rpc("submit_application", { p_job_id: fresh });
    expect(filled.error?.message).toMatch(/job is filled/);
    const audit = await pool.query("select action, after_data::text as after from public.audit_logs where entity_id=$1 or after_data->>'application_id'=$2", [
      accepted.data,
      submitted.data,
    ]);
    const blob = audit.rows.map((row) => `${row.action} ${row.after}`).join("\n");
    expect(blob).toContain("assignment.create");
    expect(blob).not.toContain("400 Broadway");
    expect(blob).not.toContain("BSIS-999111");
    await addCredential(worker, firearmType, "FIRE-999111");
    const armed = await worker.client.rpc("submit_application", { p_job_id: armedJob, p_note: "armed" });
    expect(armed.error).toBeNull();
  });
});

describe("search plan", () => {
  it("keeps the public search indexes usable", async () => {
    const client = await pool.connect();
    let plan = "";
    try {
      await client.query("begin");
      await client.query("select set_config('app.job_status_transition', '1', true)");
      await client.query(
        `insert into public.jobs (
           organization_id, title, description, job_type, category, is_armed, status, urgency,
           city, county, postal_code, approx_lat, approx_lng, pay_type, pay_min_cents, workers_needed, starts_at, ends_at
         )
         select $1, 'Load '||g, 'Explain-only shift for the planner.', 'single_shift', 'unarmed_security', false, 'draft',
                case when g % 20 = 0 then 'urgent'::public.job_urgency else 'normal'::public.job_urgency end,
                'Oakland', 'Alameda', '94612',
                round((32.5 + (g % 80) * 0.08)::numeric, 2),
                round((-124.4 + (g % 50) * 0.08)::numeric, 2),
                'hourly', 2500, 1,
                timestamptz '2026-12-01 17:00+00', timestamptz '2026-12-01 21:00+00'
         from generate_series(1, 2000) g`,
        [orgId],
      );
      await client.query(
        "update public.jobs set status = 'published' where organization_id = $1 and title like 'Load %'",
        [orgId],
      );
      await client.query("analyze public.jobs");
      const normal = await client.query(
        `explain (format text)
         select id from public.jobs
         where status = 'published'
           and approx_lat between 34.00 and 34.20
           and approx_lng between -122.20 and -122.00`,
      );
      const ordered = await client.query(
        `explain (format text)
         select id from public.jobs
         where status = 'published'
         order by (case urgency when 'urgent' then 0 when 'priority' then 1 else 2 end),
                  starts_at asc nulls last, published_at desc nulls last, id
         limit 20`,
      );
      const search = await client.query(
        `explain (format text)
         select id, distance_miles from public.search_jobs(
           34.10::numeric, -122.10::numeric, 25::numeric, null::text, null::text,
           null::integer, null::date, null::text, null::time, null::time,
           null::public.security_category, null::boolean, null::text, null::smallint,
           null::uuid, null::public.job_type, null::text, false, 20, 0
         )`,
      );
      plan = [
        "-- selective bbox",
        ...normal.rows.map((row) => row["QUERY PLAN"]),
        "",
        "-- default sort",
        ...ordered.rows.map((row) => row["QUERY PLAN"]),
        "",
        "-- search_jobs wrapper (not inlined because search_path is pinned)",
        ...search.rows.map((row) => row["QUERY PLAN"]),
      ].join("\n");
      expect(normal.rows.map((row) => row["QUERY PLAN"]).join("\n")).toMatch(/jobs_published_approx_idx/);
    } finally {
      await client.query("rollback");
      client.release();
    }
    await pool.query("analyze public.jobs");
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync("/opt/cursor/artifacts/search-explain.txt", plan);
    const indexes = await pool.query("select indexname from pg_indexes where schemaname='public' and tablename='jobs' and indexname like 'jobs_published%' order by 1");
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "jobs_published_approx_idx",
      "jobs_published_city_idx",
      "jobs_published_county_idx",
      "jobs_published_shift_idx",
      "jobs_published_sort_idx",
    ]);
  }, 60_000);
});
