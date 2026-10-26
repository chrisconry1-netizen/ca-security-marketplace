"use server";

import { redirect } from "next/navigation";
import { formString } from "@/lib/form";
import { marketplaceErrorCode } from "@/lib/jobs/messages";
import { jobErrorCode, organizationSchema } from "@/lib/jobs/validation";
import { createClient } from "@/lib/supabase/server";
import { requestMeta } from "@/server/audit/audit";
import { requireArea } from "@/server/auth/guards";

function fail(code: string): never {
  redirect(`/employer/org?error=${code}`);
}

export async function createOrganization(fd: FormData) {
  await requireArea("employer");
  const parsed = organizationSchema.safeParse({
    name: formString(fd, "name"),
    orgType: formString(fd, "orgType"),
    description: formString(fd, "description"),
  });
  if (!parsed.success) fail(jobErrorCode(parsed.error));
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_org_type: parsed.data.orgType,
    p_description: parsed.data.description || null,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) fail(marketplaceErrorCode(error.message));
  redirect("/employer/org?notice=org_created");
}
