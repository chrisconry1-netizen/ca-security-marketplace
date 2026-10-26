import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PW = "E2e-Message-Passw0rd";

test("two phones exchange messages in realtime", async ({ browser }) => {
  test.setTimeout(180_000);
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  const stamp = Date.now();
  const workerEmail = `e2e-msg-w-${stamp}@example.test`;
  const employerEmail = `e2e-msg-e-${stamp}@example.test`;
  const orgName = `E2E Msg ${stamp}`;
  const title = `Gate shift ${stamp}`;
  const employerText = `Gate opens at nine ${stamp}`;
  const workerText = `I will cover the gate ${stamp}`;
  const workerUser = await admin.auth.admin.createUser({ email: workerEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Guard" } });
  const employerUser = await admin.auth.admin.createUser({ email: employerEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Employer" } });
  if (!workerUser.data.user || !employerUser.data.user) throw workerUser.error ?? employerUser.error;
  const workerId = workerUser.data.user.id;
  const employerId = employerUser.data.user.id;
  const workerClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const employerClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let orgId = "";
  const employerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const workerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const employerPage = await employerContext.newPage();
  const workerPage = await workerContext.newPage();

  try {
    expect(employerPage.viewportSize()?.width).toBe(390);
    expect(workerPage.viewportSize()?.width).toBe(390);
    if ((await workerClient.auth.signInWithPassword({ email: workerEmail, password: PW })).error) throw new Error("worker sign-in failed");
    if ((await employerClient.auth.signInWithPassword({ email: employerEmail, password: PW })).error) throw new Error("employer sign-in failed");
    expect((await workerClient.rpc("select_account_type", { p_account_type: "worker" })).error).toBeNull();
    expect((await employerClient.rpc("select_account_type", { p_account_type: "employer" })).error).toBeNull();
    const org = await employerClient.rpc("create_organization", { p_name: orgName, p_org_type: "ppo", p_service_counties: ["Alameda"] });
    if (org.error || !org.data) throw org.error ?? new Error("org failed");
    orgId = org.data as string;
    await db.query("begin");
    await db.query("select set_config('app.org_verification_transition', '1', true)");
    await db.query("update public.organizations set verification_status='pending' where id=$1", [orgId]);
    await db.query("update public.organizations set verification_status='verified', verified_at=now() where id=$1", [orgId]);
    await db.query("commit");
    const draft = await employerClient.rpc("save_job_draft", {
      p_organization_id: orgId,
      p_job_id: null,
      p_title: title,
      p_description: "Gate coverage for a downtown building.",
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
    if (draft.error || !draft.data) throw draft.error ?? new Error("draft failed");
    expect((await employerClient.rpc("publish_job", { p_job_id: draft.data })).error).toBeNull();
    const applied = await workerClient.rpc("submit_application", { p_job_id: draft.data, p_note: "Available for the gate." });
    if (applied.error || !applied.data) throw applied.error ?? new Error("apply failed");
    const opened = await employerClient.rpc("open_conversation", { p_application_id: applied.data });
    if (opened.error || !opened.data) throw opened.error ?? new Error("open failed");
    const thread = `/messages/${opened.data}`;

    async function signIn(page: typeof employerPage, email: string) {
      await page.goto(`/login?next=${encodeURIComponent(thread)}`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(PW);
      await page.getByRole("button", { name: "Sign in" }).click();
    }

    await signIn(workerPage, workerEmail);
    await signIn(employerPage, employerEmail);
    await expect(workerPage.getByRole("heading", { name: "E2E Employer" })).toBeVisible();
    await expect(employerPage.getByRole("heading", { name: "E2E Guard" })).toBeVisible();
    await expect(workerPage.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(employerPage.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(workerPage.getByText("Do not ask about conviction history.")).toBeVisible();

    await employerPage.getByLabel("Message").fill(employerText);
    await employerPage.getByRole("button", { name: "Send", exact: true }).click();
    await expect(employerPage.getByText(employerText)).toBeVisible({ timeout: 15_000 });
    await expect(workerPage.getByText(employerText)).toBeVisible({ timeout: 15_000 });
    await workerPage.getByLabel("Message").fill(workerText);
    await workerPage.getByRole("button", { name: "Send", exact: true }).click();
    await expect(employerPage.getByText(workerText)).toBeVisible({ timeout: 15_000 });

    await employerPage.getByRole("button", { name: "Send shift card" }).click();
    await expect(workerPage.getByText(title)).toBeVisible({ timeout: 15_000 });
    await expect(workerPage.getByText("400 Broadway")).toHaveCount(0);

    const pngPath = "/tmp/guardgig-message.png";
    const width = 32;
    const height = 32;
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y += 1) {
      const row = y * (1 + width * 4);
      raw[row] = 0;
      for (let x = 0; x < width; x += 1) {
        const i = row + 1 + x * 4;
        const edge = y < 4 || x < 4;
        raw[i] = edge ? 255 : 30;
        raw[i + 1] = edge ? 255 : 58;
        raw[i + 2] = edge ? 255 : 95;
        raw[i + 3] = 255;
      }
    }
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type), data]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const checksum = Buffer.alloc(4);
      checksum.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([length, body, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    writeFileSync(
      pngPath,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
      ]),
    );
    await workerPage.locator('input[type="file"]').setInputFiles(pngPath);
    await workerPage.getByLabel("Message").fill(`Photo ${stamp}`);
    await workerPage.getByRole("button", { name: "Send", exact: true }).click();
    await expect(employerPage.getByRole("img", { name: "Message attachment" })).toBeVisible({ timeout: 15_000 });
    await employerPage.screenshot({ path: "/opt/cursor/artifacts/messaging-thread.png", fullPage: true });
  } finally {
    await employerContext.close();
    await workerContext.close();
    if (orgId) {
      await db.query("delete from public.jobs where organization_id=$1", [orgId]);
      await db.query("delete from public.organizations where id=$1", [orgId]);
    }
    await admin.auth.admin.deleteUser(workerId);
    await admin.auth.admin.deleteUser(employerId);
    await db.end();
  }
});
