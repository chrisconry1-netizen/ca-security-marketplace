import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PW = "E2e-Market-Passw0rd";

test("worker finds a shift, applies, and accepts an offer on a phone", async ({ page }) => {
  test.setTimeout(180_000);
  expect(page.viewportSize()?.width).toBe(390);
  mkdirSync("/opt/cursor/artifacts", { recursive: true });

  const stamp = Date.now();
  const workerEmail = `e2e-mkt-w-${stamp}@example.test`;
  const employerEmail = `e2e-mkt-e-${stamp}@example.test`;
  const modEmail = `e2e-mkt-m-${stamp}@example.test`;
  const orgName = `E2E Org ${stamp}`;
  const title = `Lobby ${stamp}`;
  const note = "I can work this lobby post.";
  const workerUser = await admin.auth.admin.createUser({ email: workerEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Guard" } });
  const employerUser = await admin.auth.admin.createUser({ email: employerEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Employer" } });
  const moderator = await admin.auth.admin.createUser({ email: modEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Moderator" } });
  if (!workerUser.data.user || !employerUser.data.user || !moderator.data.user) throw workerUser.error ?? employerUser.error ?? moderator.error;
  const workerId = workerUser.data.user.id;
  const employerId = employerUser.data.user.id;
  const moderatorId = moderator.data.user.id;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query("update public.profiles set account_type='staff', platform_role='moderator' where id=$1", [moderatorId]);

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(employerEmail);
    await page.getByLabel("Password").fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: /I need security staff/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("I need security staff");
    await page.getByRole("link", { name: "Create organization" }).click();
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("Organization type").selectOption("ppo");
    await page.getByLabel("Contact email").fill(employerEmail);
    await page.getByLabel("Service counties").fill("Alameda");
    await page.getByLabel("License type").fill("PPO");
    await page.getByLabel("License number").fill("PPO 12345-A");
    await page.getByRole("button", { name: "Save organization" }).click();
    await expect(page.getByText(orgName)).toBeVisible();
    await db.query("begin");
    await db.query("select set_config('app.org_verification_transition', '1', true)");
    await db.query("update public.organizations set verification_status='pending' where name=$1", [orgName]);
    await db.query("update public.organizations set verification_status='verified', verified_at=now() where name=$1", [orgName]);
    await db.query("commit");

    await page.getByRole("link", { name: "Jobs", exact: true }).click();
    await page.getByRole("link", { name: "New job" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Description").fill("Lobby coverage for a downtown building.");
    await page.getByLabel("Job type").selectOption("single_shift");
    await page.getByLabel("Security category").selectOption("unarmed_security");
    await page.getByLabel("City").fill("Oakland");
    await page.getByLabel("County").fill("Alameda");
    await page.getByLabel("ZIP code").fill("94612");
    await page.getByLabel("Site street address (private)").fill("400 Broadway");
    await page.getByLabel("Start date").fill("2026-11-15");
    await page.getByLabel("Start time").fill("09:00");
    await page.getByLabel("End date").fill("2026-11-15");
    await page.getByLabel("End time").fill("17:00");
    await page.getByLabel("Amount (USD)").fill("28.00");
    await page.getByRole("checkbox", { name: "CA Guard Registration (BSIS)", exact: true }).check();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Job published.")).toBeVisible();
    const jobUrl = page.url().replace(/\/employer\/jobs\/([^?]+).*/, "/jobs/$1");

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Email").fill(workerEmail);
    await page.getByLabel("Password").fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: /I need security work/ }).click();
    await page.goto(`/jobs?employer=${encodeURIComponent(orgName)}`);
    await expect(page.getByRole("heading", { name: "What's available for me to work?" })).toBeVisible();
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/marketplace-search.png", fullPage: true });
    await page.getByRole("link", { name: title }).click();
    await expect(page.getByText("$28.00 / hour")).toBeVisible();
    await expect(page.getByText("Verified employer")).toBeVisible();
    await expect(page.getByText("400 Broadway")).toHaveCount(0);
    await expect(page.getByText("verified credentials you do not have yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply to this shift" })).toHaveCount(0);
    await page.screenshot({ path: "/opt/cursor/artifacts/marketplace-detail-private.png", fullPage: true });

    const workerClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const signedIn = await workerClient.auth.signInWithPassword({ email: workerEmail, password: PW });
    if (signedIn.error) throw signedIn.error;
    const typeId = (await db.query("select id from public.credential_types where code='ca_guard_registration'")).rows[0].id;
    const documentPath = `${workerId}/${randomUUID()}.pdf`;
    const uploaded = await workerClient.storage.from("credential-documents").upload(
      documentPath,
      Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
      { contentType: "application/pdf" },
    );
    if (uploaded.error) throw uploaded.error;
    const inserted = await workerClient
      .from("credentials")
      .insert({
        worker_id: workerId,
        credential_type_id: typeId,
        credential_number: "BSIS-999111",
        issuer: "CA BSIS",
        issued_on: "2024-01-15",
        expires_on: "2028-01-15",
        document_path: documentPath,
        status: "unverified",
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) throw inserted.error ?? new Error("credential insert failed");
    const submitted = await workerClient.rpc("submit_credential", { p_credential_id: inserted.data.id });
    if (submitted.error) throw submitted.error;
    const modClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const modSign = await modClient.auth.signInWithPassword({ email: modEmail, password: PW });
    if (modSign.error) throw modSign.error;
    const reviewed = await modClient.rpc("review_credential", {
      p_credential_id: inserted.data.id,
      p_result: "verified",
      p_method: "document_review",
      p_source_reference: "Reviewed the guard card",
    });
    if (reviewed.error) throw reviewed.error;

    await page.reload();
    await expect(page.getByRole("button", { name: "Apply to this shift" })).toBeVisible();
    await page.getByLabel("Note for the employer").fill(note);
    await page.getByRole("button", { name: "Apply to this shift" }).click();
    await expect(page.getByText("Application submitted")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.getByLabel("Email").fill(employerEmail);
    await page.getByLabel("Password").fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("I need security staff");
    await page.goto(jobUrl.replace("/jobs/", "/employer/jobs/"));
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.getByText("BSIS-999111")).toHaveCount(0);
    await expect(page.getByText("CA Guard Registration (BSIS)")).toBeVisible();
    await page.getByRole("button", { name: "Shortlist" }).click();
    await expect(page.getByText("Shortlisted")).toBeVisible();
    await page.getByRole("button", { name: "Offer" }).click();
    await expect(page.getByText("Offered")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.getByLabel("Email").fill(workerEmail);
    await page.getByLabel("Password").fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("I need security work");
    await page.goto("/worker/applications");
    await page.getByRole("link", { name: title }).click();
    await page.getByRole("button", { name: "Accept offer" }).click();
    await expect(page.getByText("You accepted the offer")).toBeVisible();
    await expect(page.getByText("400 Broadway")).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/marketplace-accepted-address.png", fullPage: true });
    await page.goto(jobUrl);
    await expect(page.getByText("400 Broadway")).toBeVisible();
    await page.goto("/worker");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto(jobUrl);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("$28.00 / hour")).toBeVisible();
    await expect(page.getByText("Verified employer")).toBeVisible();
    await expect(page.getByText("400 Broadway")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in to apply" })).toBeVisible();
  } finally {
    await db.query(
      `delete from public.assignments
       where worker_id = $1 or organization_id in (select id from public.organizations where created_by = $2)`,
      [workerId, employerId],
    );
    await db.query("delete from public.jobs where organization_id in (select id from public.organizations where created_by = $1)", [employerId]);
    await db.query("delete from public.organizations where created_by = $1", [employerId]);
    await db.end();
    await admin.auth.admin.deleteUser(workerId);
    await admin.auth.admin.deleteUser(employerId);
    await admin.auth.admin.deleteUser(moderatorId);
  }
});
