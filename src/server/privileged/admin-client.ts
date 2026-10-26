import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * service_role client — BYPASSES RLS. Only import from src/server/** (lint-enforced).
 * Every privileged write must be preceded by a server-side authorization check
 * and followed by an audit() call.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing required environment variable SUPABASE_SERVICE_ROLE_KEY");
  return createClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
