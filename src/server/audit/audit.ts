import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/server/privileged/admin-client";
import type { AuthAuditAction } from "@/lib/auth/validation";

export type ActorType = "user" | "admin" | "system" | "ai_assistant" | "ava_api" | "stripe_webhook";

export interface AuditEvent {
  actorType: ActorType;
  actorId: string | null;
  action: string; // dotted verb, e.g. 'credential.verify'
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  before?: unknown;
  after?: unknown;
}

async function requestMeta() {
  const h = await headers();
  return {
    user_agent: h.get("user-agent")?.slice(0, 512) ?? null,
    request_id: h.get("x-request-id")?.slice(0, 128) ?? null,
    ip_address: h.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
  };
}

/** Self-service auth events via whitelisted RPC (actor forced to auth.uid() in SQL). */
export async function recordAuthEvent(supabase: SupabaseClient, action: AuthAuditAction) {
  const meta = await requestMeta();
  const { error } = await supabase.rpc("record_auth_event", {
    p_action: action,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
  });
  if (error) console.error("audit.record_auth_event_failed", { action, code: error.code });
}

/** Privileged audit write (service_role). Call AFTER an authorized privileged action. */
export async function audit(event: AuditEvent) {
  const meta = await requestMeta();
  const { error } = await createAdminClient()
    .from("audit_logs")
    .insert({
      actor_type: event.actorType,
      actor_id: event.actorId,
      organization_id: event.organizationId ?? null,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId ?? null,
      before_data: event.before ?? null,
      after_data: event.after ?? null,
      ...meta,
    });
  if (error) throw new Error(`audit write failed: ${error.code}`);
}
