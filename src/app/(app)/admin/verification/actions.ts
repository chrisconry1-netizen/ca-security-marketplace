"use server";

import { redirect } from "next/navigation";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { formString } from "@/lib/form";
import { createClient } from "@/lib/supabase/server";
import { reviewSchema } from "@/lib/workers/validation";
import { requestMeta } from "@/server/audit/audit";
import { requireRole } from "@/server/auth/guards";

export async function reviewCredential(fd: FormData) {
  await requireRole(STAFF_ROLES, "/admin/verification");
  const parsed = reviewSchema.safeParse({
    credentialId: formString(fd, "credentialId"),
    decision: formString(fd, "decision"),
    method: formString(fd, "method"),
    sourceReference: formString(fd, "sourceReference"),
    notes: formString(fd, "notes"),
    validUntil: formString(fd, "validUntil"),
  });
  const id = formString(fd, "credentialId");
  const fail = `/admin/verification/${id || ""}?error=review_failed`;
  if (!parsed.success) redirect(fail);
  if (parsed.data.decision === "verified" && !parsed.data.sourceReference) redirect(fail);
  if (parsed.data.decision === "rejected" && !parsed.data.notes) redirect(fail);

  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("review_credential", {
    p_credential_id: parsed.data.credentialId,
    p_result: parsed.data.decision,
    p_method: parsed.data.method,
    p_source_reference: parsed.data.sourceReference || null,
    p_notes: parsed.data.notes || null,
    p_valid_until: parsed.data.validUntil || null,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) {
    console.error("credential.review_failed", error.code);
    redirect(fail);
  }
  redirect(`/admin/verification/${parsed.data.credentialId}?notice=reviewed`);
}
