import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { randomUUID } from "node:crypto";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DB = process.env.DATABASE_URL!;

if (!URL || !ANON || !SERVICE || !DB) throw new Error("RLS tests need the LOCAL Supabase stack env (.env.local)");
if (!/127\.0\.0\.1|localhost/.test(URL) || !/127\.0\.0\.1|localhost/.test(DB)) {
  throw new Error("Refusing to run RLS tests against a non-local Supabase/database");
}

export const runId = randomUUID().slice(0, 8);
export const PASSWORD = "Rls-Test-Passw0rd!";
export const pool = new pg.Pool({ connectionString: DB, max: 4 });
export const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
export const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

export async function createUser(label: string, metadata: Record<string, unknown> = {}): Promise<TestUser> {
  const email = `rls-${label}-${runId}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: metadata });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  const client = anonClient();
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw new Error(`signIn ${label}: ${e2.message}`);
  return { id: data.user.id, email, client };
}

/** Run SQL as an authenticated user (PostgREST-equivalent JWT claims) in a rolled-back tx. */
export async function asUser<T>(uid: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${uid ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" })]);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}

export async function sqlError(uid: string | null, sql: string, params: unknown[] = []): Promise<string | null> {
  return asUser(uid, async (c) => {
    try {
      await c.query(sql, params);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? "error";
    }
  });
}

export async function cleanup(users: TestUser[]) {
  for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {});
}
