import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const email = `e2e-${Date.now()}@example.test`;
const pw1 = "E2e-Initial-Passw0rd";
const pw2 = "E2e-Changed-Passw0rd";

async function latestLink(to: string, after: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const r = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    const msg = (r.messages ?? []).find((m: { Created: string }) => new Date(m.Created).getTime() >= after);
    if (msg) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      const m = String(full.Text ?? full.HTML).match(/https?:\/\/[^\s"<>)]+verify[^\s"<>)]+/);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error("email not received");
}

async function login(page: Page, password: string, next = "") {
  await page.goto(`/login${next}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("register → verify → account type → guards → logout → reset password", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("security shift marketplace");

  // unauthenticated access to protected areas is redirected
  await page.goto("/worker");
  await expect(page).toHaveURL(/\/login\?next=%2Fworker/);

  const t0 = Date.now() - 2000;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("E2E Worker");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(pw1);
  await page.getByLabel("Confirm password").fill(pw1);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email$/);

  await login(page, pw1);
  await expect(page.locator("main").getByRole("alert")).toContainText("verify your email");

  await page.goto(await latestLink(email, t0));
  await expect(page).toHaveURL(/\/account-type$/);
  await page.getByRole("button", { name: /I need security work/ }).click();
  await expect(page).toHaveURL(/\/worker$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("I need security work");

  // server-side authorization: a worker cannot reach employer/admin areas or re-pick a type
  for (const p of ["/employer", "/admin"]) {
    await page.goto(p);
    await expect(page).toHaveURL(/\/forbidden$/);
  }
  await page.goto("/account-type");
  await expect(page).toHaveURL(/\/worker$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed_out/);
  await page.goto("/worker");
  await expect(page).toHaveURL(/\/login/);

  // open-redirect attempt is neutralised
  await login(page, pw1, "?next=https%3A%2F%2Fevil.example");
  await expect(page).toHaveURL(/localhost:3000\/worker$/);
  await page.getByRole("button", { name: "Sign out" }).click();

  const t1 = Date.now() - 2000;
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("reset link");
  await page.goto(await latestLink(email, t1));
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill(pw2);
  await page.getByLabel("Confirm new password").fill(pw2);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/worker$/);
  await page.getByRole("button", { name: "Sign out" }).click();

  await login(page, pw1);
  await expect(page.locator("main").getByRole("alert")).toContainText("incorrect");
  await login(page, pw2);
  await expect(page).toHaveURL(/\/worker$/);

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    "select distinct action from public.audit_logs a join auth.users u on u.id = a.actor_id where u.email = $1 order by 1",
    [email],
  );
  await db.end();
  expect(rows.map((r) => r.action)).toEqual(
    expect.arrayContaining(["account.type_selected", "auth.email_verified", "auth.login", "auth.logout", "auth.password_updated", "auth.user_created"]),
  );
});
