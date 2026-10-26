import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, cleanup, createUser, pool, sqlError, type TestUser } from "./helpers";

let ready: TestUser;
let hidden: TestUser;
let far: TestUser;
let blocked: TestUser;
let idle: TestUser;
let pricey: TestUser;
let blackout: TestUser;
let employer: TestUser;
let otherEmployer: TestUser;
let orgId: string;
let corporateOrgId: string;
let goodJob: string;
let armedJob: string;
let corporateArmedJob: string;
let epJob: string;
let offDutyJob: string;
let draftJob: string;
let guardType: string;
let firearmType: string;

const secretNumber = "BSIS-SECRET-61";

async function saveDraft(client: TestUser["client"], organizationId: string, title: string, patch: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc("save_job_draft", {
    p_organization_id: organizationId,
    p_job_id: null,
    p_title: title,
    p_description: "Lobby coverage for the matching test shift.",
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

async function verifyOrg(id: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.org_verification_transition', '1', true)");
    await client.query("update public.organizations set verification_status='pending' where id=$1", [id]);
    await client.query("update public.organizations set verification_status='verified', verified_at=now() where id=$1", [id]);
    await client.query("commit");
  } finally {
    client.release();
  }
}

async function placeWorker(user: TestUser, patch: Record<string, unknown>) {
  const { error } = await user.client.from("worker_profiles").update({
    city: "Oakland",
    county: "Alameda",
    postal_code: "94612",
    work_radius_miles: 40,
    years_experience: 4,
    preferred_categories: ["unarmed_security"],
    is_searchable: true,
    ...patch,
  }).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  const { error: windowError } = await user.client.from("worker_availability").insert({
    worker_id: user.id,
    weekday: 0,
    start_time: "08:00",
    end_time: "18:00",
    is_available: true,
  });
  if (windowError) throw new Error(windowError.message);
}

async function grantCredential(userId: string, typeId: string, number: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      `insert into public.credentials
        (worker_id, credential_type_id, credential_number, issuer, issued_on, expires_on, document_path, status)
       values ($1, $2, $3, 'CA BSIS', '2024-01-15', '2028-01-15', $4, 'verified')`,
      [userId, typeId, number, `${userId}/${randomUUID()}.pdf`],
    );
    await client.query("commit");
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  [ready, hidden, far, blocked, idle, pricey, blackout, employer, otherEmployer] = await Promise.all(
    ["p6ready", "p6hide", "p6far", "p6block", "p6idle", "p6pay", "p6busy", "p6emp", "p6other"].map((label) =>
      createUser(label, { display_name: label }),
    ),
  );
  for (const user of [ready, hidden, far, blocked, idle, pricey, blackout]) {
    const selected = await user.client.rpc("select_account_type", { p_account_type: "worker" });
    if (selected.error) throw new Error(selected.error.message);
  }
  for (const user of [employer, otherEmployer]) {
    const selected = await user.client.rpc("select_account_type", { p_account_type: "employer" });
    if (selected.error) throw new Error(selected.error.message);
  }
  const types = await pool.query("select id, code from public.credential_types where code in ('ca_guard_registration','ca_exposed_firearm_permit')");
  guardType = types.rows.find((row) => row.code === "ca_guard_registration").id;
  firearmType = types.rows.find((row) => row.code === "ca_exposed_firearm_permit").id;

  const created = await employer.client.rpc("create_organization", { p_name: `Match PPO ${ready.id.slice(0, 8)}`, p_org_type: "ppo" });
  if (created.error || !created.data) throw new Error(created.error?.message ?? "create org failed");
  orgId = created.data as string;
  const corporate = await otherEmployer.client.rpc("create_organization", { p_name: `Match Corp ${ready.id.slice(0, 8)}`, p_org_type: "corporate" });
  if (corporate.error || !corporate.data) throw new Error(corporate.error?.message ?? "create corporate org failed");
  corporateOrgId = corporate.data as string;
  await verifyOrg(orgId);
  await verifyOrg(corporateOrgId);

  goodJob = await saveDraft(employer.client, orgId, "Match lobby shift");
  armedJob = await saveDraft(employer.client, orgId, "Match armed shift", { p_is_armed: true, p_category: "armed_security", p_required_codes: [] });
  epJob = await saveDraft(employer.client, orgId, "Match protection shift", { p_category: "executive_protection", p_required_codes: ["ca_guard_registration"] });
  offDutyJob = await saveDraft(employer.client, orgId, "Match off-duty shift");
  draftJob = await saveDraft(employer.client, orgId, "Match draft shift");
  corporateArmedJob = await saveDraft(otherEmployer.client, corporateOrgId, "Match corporate armed shift", {
    p_is_armed: true,
    p_category: "armed_security",
    p_required_codes: [],
  });
  const flagged = await employer.client.from("jobs").update({ requires_off_duty_le: true }).eq("id", offDutyJob).select("id");
  if (flagged.error || !flagged.data?.length) throw new Error(flagged.error?.message ?? "off-duty flag failed");
  for (const id of [goodJob, armedJob, epJob, offDutyJob, corporateArmedJob]) {
    const client = id === corporateArmedJob ? otherEmployer.client : employer.client;
    const published = await client.rpc("publish_job", { p_job_id: id });
    if (published.error) throw new Error(published.error.message);
  }

  await placeWorker(ready, {});
  await placeWorker(hidden, { is_searchable: false });
  await placeWorker(far, { city: "San Diego", county: "San Diego", postal_code: null, work_radius_miles: 10 });
  await placeWorker(blocked, {});
  await placeWorker(pricey, { min_hourly_rate_cents: 50000 });
  await placeWorker(blackout, {});
  const idleProfile = await idle.client.from("worker_profiles").update({
    city: "Oakland",
    county: "Alameda",
    postal_code: "94612",
    work_radius_miles: 40,
    is_searchable: true,
  }).eq("user_id", idle.id);
  if (idleProfile.error) throw new Error(idleProfile.error.message);
  const blackoutRow = await blackout.client.from("worker_availability").insert({
    worker_id: blackout.id,
    weekday: 0,
    start_time: "12:00",
    end_time: "13:00",
    is_available: false,
  });
  if (blackoutRow.error) throw new Error(blackoutRow.error.message);

  await grantCredential(ready.id, guardType, secretNumber);
  await grantCredential(ready.id, firearmType, "FIRE-SECRET-61");
  for (const user of [hidden, far, blocked, idle, pricey, blackout]) {
    await grantCredential(user.id, guardType, `CARD-${user.id.slice(0, 8)}`);
  }
  const block = await employer.client.from("user_blocks").insert({ blocker_id: employer.id, blocked_id: blocked.id });
  if (block.error) throw new Error(block.error.message);
});

afterAll(async () => {
  const orgs = [orgId, corporateOrgId].filter(Boolean);
  if (orgs.length) {
    await pool.query("delete from public.assignments where organization_id = any($1::uuid[])", [orgs]);
    await pool.query("delete from public.jobs where organization_id = any($1::uuid[])", [orgs]);
    await pool.query("delete from public.organizations where id = any($1::uuid[])", [orgs]);
  }
  await cleanup([ready, hidden, far, blocked, idle, pricey, blackout, employer, otherEmployer].filter(Boolean));
  await pool.end();
});

describe("matching access", () => {
  it("denies anon, direct writes, and a signed-in call to the service-only recorder", async () => {
    expect(await sqlError(null, "select id from public.match_runs")).toBe("42501");
    expect(await sqlError(null, "select id from public.match_suggestions")).toBe("42501");
    expect((await anonClient().rpc("eligible_shifts_for_me")).error).not.toBeNull();
    expect((await anonClient().rpc("eligible_workers_for_job", { p_job_id: goodJob })).error).not.toBeNull();
    expect(
      await sqlError(ready.id, "insert into public.match_runs (requester_id, direction, worker_id, model, model_version, source, fallback_reason, eligible_count, ranked_count, prompt_fields) values ($1, 'jobs_for_worker', $1, 'deterministic', 'v1', 'deterministic_fallback', 'missing_api_key', 0, 0, '{id}')", [ready.id]),
    ).toBe("42501");
    const denied = await ready.client.rpc("record_match_run", {
      p_actor: ready.id,
      p_direction: "jobs_for_worker",
      p_job_id: null,
      p_ordered_ids: [],
      p_reason_codes: {},
      p_model: "deterministic",
      p_model_version: "v1",
      p_source: "deterministic_fallback",
      p_fallback_reason: "missing_api_key",
      p_input_tokens: null,
      p_output_tokens: null,
      p_user_agent: null,
      p_request_id: null,
      p_ip: null,
    });
    expect(denied.error).not.toBeNull();
    expect((await ready.client.rpc("eligible_workers_for_job", { p_job_id: goodJob })).error?.code).toBe("42501");
    expect((await otherEmployer.client.rpc("eligible_workers_for_job", { p_job_id: goodJob })).error?.code).toBe("42501");
  });

  it("keeps realtime message policies applied without this phase owning that table", async () => {
    const policies = await pool.query(
      "select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages' order by policyname",
    );
    expect(policies.rows.map((row) => row.policyname)).toEqual(["conversation_realtime_insert", "conversation_realtime_select"]);
    const security = await pool.query(
      "select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'realtime' and c.relname = 'messages'",
    );
    expect(security.rows[0].relrowsecurity).toBe(true);
  });
});

describe("eligibility results", () => {
  it("returns only shifts the worker already passes", async () => {
    const shifts = await ready.client.rpc("eligible_shifts_for_me");
    expect(shifts.error).toBeNull();
    const ids = (shifts.data ?? []).map((row: { job_id: string }) => row.job_id);
    expect(ids).toContain(goodJob);
    expect(ids).toContain(armedJob);
    expect(ids).not.toContain(epJob);
    expect(ids).not.toContain(offDutyJob);
    expect(ids).not.toContain(corporateArmedJob);
    expect(ids).not.toContain(draftJob);
    const own = await hidden.client.rpc("eligible_shifts_for_me");
    const hiddenIds = (own.data ?? []).map((row: { job_id: string }) => row.job_id);
    expect(hiddenIds).toContain(goodJob);
    expect(hiddenIds).not.toContain(armedJob);
    const blockedShifts = await blocked.client.rpc("eligible_shifts_for_me");
    expect((blockedShifts.data ?? []).map((row: { job_id: string }) => row.job_id)).not.toContain(goodJob);
    const farShifts = await far.client.rpc("eligible_shifts_for_me");
    expect((farShifts.data ?? []).map((row: { job_id: string }) => row.job_id)).not.toContain(goodJob);
    const idleShifts = await idle.client.rpc("eligible_shifts_for_me");
    expect((idleShifts.data ?? []).map((row: { job_id: string }) => row.job_id)).not.toContain(goodJob);
  });

  it("shows an employer only opted-in workers who pass, without credential numbers", async () => {
    const workers = await employer.client.rpc("eligible_workers_for_job", { p_job_id: goodJob });
    expect(workers.error).toBeNull();
    const ids = (workers.data ?? []).map((row: { worker_id: string }) => row.worker_id);
    expect(ids).toContain(ready.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(far.id);
    expect(ids).not.toContain(blocked.id);
    expect(ids).not.toContain(idle.id);
    expect(ids).not.toContain(pricey.id);
    expect(ids).not.toContain(blackout.id);
    const payload = JSON.stringify(workers.data ?? []);
    expect(payload).not.toContain(secretNumber);
    expect(payload).not.toContain("400 Broadway");
    expect(payload).not.toContain("approx_lat");
    expect(payload).not.toContain("credential_number");
    expect(payload).not.toContain("languages");
    const armed = await employer.client.rpc("eligible_workers_for_job", { p_job_id: armedJob });
    const armedIds = (armed.data ?? []).map((row: { worker_id: string }) => row.worker_id);
    expect(armedIds).toContain(ready.id);
    expect(armedIds).not.toContain(hidden.id);
    expect(armedIds).not.toContain(blocked.id);
    const corporate = await otherEmployer.client.rpc("eligible_workers_for_job", { p_job_id: corporateArmedJob });
    expect(corporate.data ?? []).toEqual([]);
  });
});

describe("stored match runs", () => {
  let workerRun = "";
  let employerRun = "";

  it("drops ids that are not eligible and stores a server-built explanation", async () => {
    const recorded = await admin.rpc("record_match_run", {
      p_actor: ready.id,
      p_direction: "jobs_for_worker",
      p_job_id: null,
      p_ordered_ids: [goodJob, randomUUID()],
      p_reason_codes: { [goodJob]: ["GUARD_CARD_ACTIVE", "WITHIN_RADIUS", "INVENTED_LICENSE"] },
      p_model: "deterministic",
      p_model_version: "v1",
      p_source: "deterministic_fallback",
      p_fallback_reason: "missing_api_key",
      p_input_tokens: null,
      p_output_tokens: null,
      p_user_agent: "vitest",
      p_request_id: "phase6",
      p_ip: null,
    });
    expect(recorded.error).toBeNull();
    workerRun = recorded.data as string;
    const suggestions = await ready.client.from("match_suggestions").select("job_id, explanation, reason_codes, checklist").eq("run_id", workerRun);
    expect(suggestions.error).toBeNull();
    const jobIds = (suggestions.data ?? []).map((row) => row.job_id);
    expect(jobIds).toContain(goodJob);
    expect(jobIds).not.toContain(epJob);
    const good = (suggestions.data ?? []).find((row) => row.job_id === goodJob);
    expect(good?.explanation).toMatch(/Guard card/);
    expect(JSON.stringify(suggestions.data)).not.toContain(secretNumber);
    expect(JSON.stringify(suggestions.data)).not.toContain("INVENTED_LICENSE");
    const run = await ready.client.from("match_runs").select("source, model, model_version, fallback_reason, prompt_fields").eq("id", workerRun).single();
    expect(run.data?.source).toBe("deterministic_fallback");
    expect(run.data?.model).toBe("deterministic");
    expect(run.data?.model_version).toBe("v1");
    expect(run.data?.fallback_reason).toBe("missing_api_key");
    expect(run.data?.prompt_fields).toContain("distance_miles");
    expect(run.data?.prompt_fields).not.toContain("languages");
    expect(run.data?.prompt_fields).not.toContain("credential_number");
    const audit = await pool.query("select actor_type, action, after_data from public.audit_logs where entity_id = $1 and action = 'match.run'", [workerRun]);
    expect(audit.rows[0].actor_type).toBe("system");
    expect(audit.rows[0].action).toBe("match.run");
    expect(JSON.stringify(audit.rows[0].after_data)).not.toContain(secretNumber);
    const tools = await pool.query("select id from public.ai_tool_calls where user_id = $1", [ready.id]);
    expect(tools.rows).toEqual([]);
    expect((await hidden.client.from("match_runs").select("id").eq("id", workerRun)).data).toEqual([]);
    expect((await employer.client.from("match_runs").select("id").eq("id", workerRun)).data).toEqual([]);
  });

  it("records a Grok-labeled run only through service role and keeps the tool audit free of secrets", async () => {
    const recorded = await admin.rpc("record_match_run", {
      p_actor: employer.id,
      p_direction: "workers_for_job",
      p_job_id: goodJob,
      p_ordered_ids: [ready.id, hidden.id],
      p_reason_codes: { [ready.id]: ["GUARD_CARD_ACTIVE", "AVAILABLE"] },
      p_model: "grok-4",
      p_model_version: "grok-4",
      p_source: "grok",
      p_fallback_reason: null,
      p_input_tokens: 12,
      p_output_tokens: 4,
      p_user_agent: "vitest",
      p_request_id: "phase6-grok",
      p_ip: null,
    });
    expect(recorded.error).toBeNull();
    employerRun = recorded.data as string;
    const suggestions = await employer.client.from("match_suggestions").select("worker_id, explanation").eq("run_id", employerRun);
    const ids = (suggestions.data ?? []).map((row) => row.worker_id);
    expect(ids).toContain(ready.id);
    expect(ids).not.toContain(hidden.id);
    expect(JSON.stringify(suggestions.data)).not.toContain(secretNumber);
    const tool = await pool.query("select arguments, result_summary, model, required_confirmation from public.ai_tool_calls where user_id = $1", [employer.id]);
    expect(tool.rows).toHaveLength(1);
    expect(tool.rows[0].model).toBe("grok-4");
    expect(tool.rows[0].required_confirmation).toBe(false);
    expect(JSON.stringify(tool.rows[0].arguments)).not.toContain(secretNumber);
    expect(JSON.stringify(tool.rows[0].arguments)).toContain("distance_miles");
    const audit = await pool.query("select actor_type from public.audit_logs where entity_id = $1 and action = 'match.run'", [employerRun]);
    expect(audit.rows[0].actor_type).toBe("ai_assistant");
    expect((await otherEmployer.client.from("match_runs").select("id").eq("id", employerRun)).data).toEqual([]);
    expect((await ready.client.from("match_runs").select("id").eq("id", employerRun)).data).toEqual([]);
    expect((await employer.client.from("match_suggestions").select("worker_id").eq("run_id", employerRun)).data?.length).toBeGreaterThan(0);
  });

  it("removes a pair after the worker applies", async () => {
    const submitted = await ready.client.rpc("submit_application", { p_job_id: goodJob, p_note: null });
    expect(submitted.error).toBeNull();
    const shifts = await ready.client.rpc("eligible_shifts_for_me");
    expect((shifts.data ?? []).map((row: { job_id: string }) => row.job_id)).not.toContain(goodJob);
    const workers = await employer.client.rpc("eligible_workers_for_job", { p_job_id: goodJob });
    expect((workers.data ?? []).map((row: { worker_id: string }) => row.worker_id)).not.toContain(ready.id);
  });

  it("rate-limits match runs for the actor", async () => {
    await pool.query("delete from public.match_runs where requester_id = $1", [ready.id]);
    await pool.query(
      `insert into public.match_runs
        (requester_id, direction, worker_id, model, model_version, source, fallback_reason, eligible_count, ranked_count, prompt_fields)
       select $1, 'jobs_for_worker', $1, 'deterministic', 'v1', 'deterministic_fallback', 'missing_api_key', 0, 0, array['id']::text[]
       from generate_series(1, 20)`,
      [ready.id],
    );
    const limited = await admin.rpc("record_match_run", {
      p_actor: ready.id,
      p_direction: "jobs_for_worker",
      p_job_id: null,
      p_ordered_ids: [],
      p_reason_codes: {},
      p_model: "deterministic",
      p_model_version: "v1",
      p_source: "deterministic_fallback",
      p_fallback_reason: "empty_eligible_set",
      p_input_tokens: null,
      p_output_tokens: null,
      p_user_agent: null,
      p_request_id: null,
      p_ip: null,
    });
    expect(limited.error?.message).toMatch(/match rate limit/);
    expect(limited.data).toBeNull();
  });
});
