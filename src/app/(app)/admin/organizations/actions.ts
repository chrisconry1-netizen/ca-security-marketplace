"use server";

import { redirect } from "next/navigation";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { employerErrorCode } from "@/lib/employer/messages";
import { formString } from "@/lib/form";
import { reviewOrgSchema } from "@/lib/orgs/validation";
import { createClient } from "@/lib/supabase/server";
import { requestMeta } from "@/server/audit/audit";
import { requireRole } from "@/server/auth/guards";

export async function reviewOrganization(fd: FormData) {
  await requireRole(STAFF_ROLES, "/admin/organizations");
  const parsed = reviewOrgSchema.safeParse({
    organizationId: formString(fd, "organizationId"),
    decision: formString(fd, "decision"),
    notes: formString(fd, "notes"),
  });
  const id = formString(fd, "organizationId");
  if (!parsed.success) redirect(`/admin/organizations/${id}?error=review_failed`);
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("review_organization", {
    p_org: parsed.data.organizationId,
    p_result: parsed.data.decision,
    p_notes: parsed.data.notes,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) {
    console.error("organization.review_failed", error.code);
    redirect(`/admin/organizations/${id}?error=${employerErrorCode(error.message)}`);
  }
  redirect(`/admin/organizations/${id}?notice=reviewed`);
}
