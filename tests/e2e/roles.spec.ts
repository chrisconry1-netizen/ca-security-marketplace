import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PW = "E2e-Roles-Passw0rd1";

async function makeUser(tag: string, sql?: string) {
  const email = `e2e-${tag}-${Date.now()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw error;
  if (sql) {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(sql, [data.user!.id]);
    await db.end();
  }
  return email;
}

for (const c of [
  { tag: "employer", sql: undefined, pick: /I need security staff/, home: "/employer", heading: "I need security staff", denied: ["/worker", "/admin"] },
  { tag: "moderator", sql: "update public.profiles set account_type='staff', platform_role='moderator' where id=$1", home: "/admin", heading: "Trust & operations", denied: ["/worker", "/employer"], audit: false },
  { tag: "admin", sql: "update public.profiles set account_type='staff', platform_role='admin' where id=$1", home: "/admin", heading: "Trust & operations", denied: ["/worker", "/employer"], audit: true },
  { tag: "suspended", sql: "update public.profiles set account_type='worker', status='suspended' where id=$1", home: "/account-inactive", heading: "Account unavailable", denied: ["/worker", "/admin"] },
]) {
  test(`${c.tag} lands on ${c.home} and is denied elsewhere`, async ({ page }) => {
    const email = await makeUser(c.tag, c.sql);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click();
    if (c.pick) {
      await expect(page).toHaveURL(/\/account-type$/);
      await page.getByRole("button", { name: c.pick }).click();
    }
    await expect(page).toHaveURL(new RegExp(`${c.home}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(c.heading);
    if (c.audit === true) await expect(page.getByText("auth.login").first()).toBeVisible();
    if (c.audit === false) await expect(page.getByText("Audit log is limited to admins.")).toBeVisible();
    for (const p of c.denied) {
      await page.goto(p);
      await expect(page).toHaveURL(c.tag === "suspended" ? /\/account-inactive$/ : /\/forbidden$/);
    }
  });
}
