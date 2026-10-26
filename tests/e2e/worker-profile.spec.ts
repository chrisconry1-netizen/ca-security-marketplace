import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PW = "E2e-Profile-Passw0rd";

test("worker builds a profile and credential; a moderator verifies it", async ({ page }) => {
  test.setTimeout(120_000);
  expect(page.viewportSize()?.width).toBe(390);

  const stamp = Date.now();
  const workerEmail = `e2e-profile-${stamp}@example.test`;
  const modEmail = `e2e-mod-${stamp}@example.test`;
  const worker = await admin.auth.admin.createUser({ email: workerEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Guard" } });
  const moderator = await admin.auth.admin.createUser({ email: modEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Moderator" } });
  if (worker.error || moderator.error || !worker.data.user || !moderator.data.user) throw worker.error ?? moderator.error;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query("update public.profiles set account_type='staff', platform_role='moderator' where id=$1", [moderator.data.user.id]);

  await page.goto("/login");
  await page.getByLabel("Email").fill(workerEmail);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /I need security work/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("I need security work");

  await page.getByRole("link", { name: "Profile" }).click();
  await page.getByRole("link", { name: "Edit profile" }).click();
  await expect(page.getByLabel(/street address/i)).toHaveCount(0);
  await expect(page.getByLabel("City")).toBeVisible();
  await page.getByLabel("Display name").fill("E2E Guard");
  await page.getByLabel("Headline").fill("Event and unarmed posts");
  await page.getByLabel("City").fill("Oakland");
  await page.getByLabel("County").fill("Alameda");
  await page.getByLabel("ZIP code").fill("94612");
  await page.getByLabel("Work radius (miles)").fill("25");
  await page.getByLabel("Bio").fill("Weeknights and weekends.");
  await page.getByLabel("Years of security experience").fill("6");
  await page.getByLabel("Security experience", { exact: true }).fill("Concerts and retail floors.");
  await page.getByRole("checkbox", { name: "Law enforcement experience", exact: true }).check();
  await page.getByLabel("Law enforcement experience details").fill("Prior patrol assignment. Not a current authorization.");
  await page.getByRole("checkbox", { name: "Unarmed" }).check();
  await page.getByRole("checkbox", { name: "Event", exact: true }).check();
  await page.getByLabel("Minimum hourly pay").fill("32.50");
  await page.getByLabel("Transportation").selectOption("yes");
  await page.getByRole("checkbox", { name: "English" }).check();
  await page.getByLabel("Skills").fill("Report writing, radio");
  await page.setInputFiles('input[name="photo"]', {
    name: "face.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
  });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(/\/worker\/profile\?notice=saved/);
  await expect(page.getByText("E2E Guard", { exact: true })).toBeVisible();
  await expect(page.getByText("Oakland · Alameda · 94612")).toBeVisible();
  await expect(page.getByText("25 miles")).toBeVisible();
  await expect(page.getByText("$32.50 / hour minimum")).toBeVisible();
  await expect(page.getByText("Concerts and retail floors.")).toBeVisible();
  await expect(page.getByText("Prior patrol assignment. Not a current authorization.")).toBeVisible();
  await expect(page.getByText("does not authorize off-duty work")).toBeVisible();
  await expect(page.getByRole("img")).toBeVisible();

  await page.goto("/worker/availability");
  await page.getByRole("button", { name: "Add weekly window" }).click();
  await expect(page.getByText("Monday 09:00–17:00")).toBeVisible();
  await page.getByLabel("Date").fill("2026-11-02");
  await page.getByRole("button", { name: "Add date exception" }).click();
  await expect(page.getByText("Not available").first()).toBeVisible();

  await page.goto("/worker/credentials/new");
  await page.getByLabel("Credential type").selectOption({ label: "CA Guard Registration (BSIS)" });
  await page.getByLabel("Credential number").fill("BSIS-123456");
  await page.getByLabel("Issuer").fill("CA BSIS");
  await page.getByLabel("Issued on").fill("2024-01-15");
  await page.getByLabel("Expires on").fill("2028-01-15");
  await page.setInputFiles('input[name="document"]', {
    name: "guard-card.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"),
  });
  await page.getByRole("button", { name: "Save credential" }).click();
  await expect(page.getByText("Unverified")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify credential" })).toHaveCount(0);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Pending review")).toBeVisible();
  await expect(page.getByText("does not contact BSIS")).toBeVisible();

  await page.goto("/admin/verification");
  await expect(page).toHaveURL(/\/forbidden$/);

  await page.goto("/worker/credentials");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill(modEmail);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/verification");
  await expect(page.getByRole("link", { name: /E2E Guard/ })).toBeVisible();
  await page.getByRole("link", { name: /E2E Guard/ }).click();
  await expect(page.getByText("BSIS-123456")).toBeVisible();
  await expect(page.getByText("does not contact BSIS")).toBeVisible();
  await page.getByLabel("Source reference").fill("Reviewed the uploaded guard card");
  await page.getByLabel("Notes").fill("Number and name match the document.");
  await page.getByRole("button", { name: "Verify credential" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();

  const audited = await db.query(
    "select count(*)::int n from public.audit_logs where action in ('credential.submit','credential.review','credential.document_url_issued') and entity_id in (select id from public.credentials where worker_id=$1)",
    [worker.data.user.id],
  );
  expect(audited.rows[0].n).toBeGreaterThanOrEqual(2);
  await db.end();
  await admin.auth.admin.deleteUser(worker.data.user.id);
  await admin.auth.admin.deleteUser(moderator.data.user.id);
});
