import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PW = "E2e-Employer-Passw0rd";

async function signIn(page: Page, email: string) {
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("employer posts a shift, a moderator verifies the org, and a recruiter cannot change roles", async ({ page }) => {
  test.setTimeout(180_000);
  expect(page.viewportSize()?.width).toBe(390);

  const stamp = Date.now();
  const ownerEmail = `e2e-owner-${stamp}@example.test`;
  const recruiterEmail = `e2e-recruiter-${stamp}@example.test`;
  const modEmail = `e2e-orgmod-${stamp}@example.test`;
  const orgName = `Harbor PPO ${stamp}`;
  const owner = await admin.auth.admin.createUser({ email: ownerEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Owner" } });
  const recruiter = await admin.auth.admin.createUser({ email: recruiterEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Recruiter" } });
  const moderator = await admin.auth.admin.createUser({ email: modEmail, password: PW, email_confirm: true, user_metadata: { display_name: "E2E Org Moderator" } });
  if (owner.error || recruiter.error || moderator.error || !owner.data.user || !recruiter.data.user || !moderator.data.user) {
    throw owner.error ?? recruiter.error ?? moderator.error;
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("update public.profiles set account_type='staff', platform_role='moderator' where id=$1", [moderator.data.user.id]);

    await page.goto("/login");
    await signIn(page, ownerEmail);
    await page.getByRole("button", { name: /I need security staff/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("I need security staff");

    await page.getByRole("link", { name: "Create organization" }).click();
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("Organization type").selectOption("ppo");
    await page.getByLabel("Contact email").fill(ownerEmail);
    await page.getByLabel("Service counties").fill("Alameda");
    await page.getByLabel("License type").fill("PPO");
    await page.getByLabel("License number").fill("PPO 12345-A");
    await page.getByRole("button", { name: "Save organization" }).click();
    await expect(page.getByText("PPO 12345-A")).toBeVisible();
    await expect(page.getByText("Shown as submitted")).toBeVisible();
    await page.getByRole("button", { name: "Submit for verification" }).click();
    await expect(page.getByText("Pending verification")).toBeVisible();

    await page.getByRole("link", { name: "Jobs", exact: true }).click();
    await page.getByRole("link", { name: "New job" }).click();
    await page.getByLabel("Title").fill("Overnight lobby");
    await page.getByLabel("Description").fill("Overnight lobby coverage for the hiring organization.");
    await page.getByLabel("City").fill("Oakland");
    await page.getByLabel("County").fill("Alameda");
    await page.getByLabel("Site street address (private)").fill("100 Market Street");
    await page.getByLabel("Start date").fill("2026-11-02");
    await page.getByLabel("Start time").fill("09:00");
    await page.getByLabel("End date").fill("2026-11-02");
    await page.getByLabel("End time").fill("17:00");
    await page.getByLabel("Amount (USD)").fill("32.00");
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Pending review")).toBeVisible();
    await expect(page.getByText("100 Market Street")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, modEmail);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/organizations");
    await page.getByRole("link", { name: new RegExp(orgName) }).click();
    await expect(page.getByText("PPO 12345-A")).toBeVisible();
    await page.getByLabel("Notes").fill("Read the license number as submitted.");
    await page.getByRole("button", { name: "Verify organization" }).click();
    await expect(page.getByText("Verified", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, ownerEmail);
    await page.locator("nav").getByRole("link", { name: "Jobs & shifts" }).click();
    await page.getByRole("link", { name: /Overnight lobby/ }).click();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByText("100 Market Street")).toBeVisible();

    await page.locator("nav").getByRole("link", { name: "Team" }).click();
    await page.getByLabel("Email").fill(recruiterEmail);
    await page.getByLabel("Role").selectOption({ label: "Recruiter/Dispatcher" });
    await page.getByRole("button", { name: "Create invite" }).click();
    const acceptHref = await page.getByRole("link", { name: "Open accept page" }).getAttribute("href");
    expect(acceptHref).toContain("token=");

    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, recruiterEmail);
    await page.getByRole("button", { name: /I need security staff/ }).click();
    await page.goto(acceptHref!);
    await page.getByRole("button", { name: "Accept invite" }).click();
    await expect(page.getByText("You joined the organization.")).toBeVisible();
    await page.locator("nav").getByRole("link", { name: "Team" }).click();
    await expect(page.getByText("Recruiter/Dispatcher")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save role" })).toHaveCount(0);
  } finally {
    await db.query("delete from public.organizations where created_by = $1", [owner.data.user.id]);
    await admin.auth.admin.deleteUser(owner.data.user.id);
    await admin.auth.admin.deleteUser(recruiter.data.user.id);
    await admin.auth.admin.deleteUser(moderator.data.user.id);
    await db.end();
  }
});
