"use server";

import { redirect } from "next/navigation";
import { employerErrorCode } from "@/lib/employer/messages";
import { formString } from "@/lib/form";
import { parseCounties } from "@/lib/orgs/constants";
import { orgSchema } from "@/lib/orgs/validation";
import { createClient } from "@/lib/supabase/server";
import { requestMeta } from "@/server/audit/audit";
import { requireArea } from "@/server/auth/guards";
import { uploadOrgLogo } from "@/server/storage/uploads";

function orgPath(id: string, query: string) {
  return `/employer/org?org=${id}&${query}`;
}

export async function saveOrganization(fd: FormData) {
  const ctx = await requireArea("employer");
  const organizationId = formString(fd, "organizationId");
  const parsed = orgSchema.safeParse({
    name: formString(fd, "name"),
    orgType: formString(fd, "orgType"),
    website: formString(fd, "website"),
    contactEmail: formString(fd, "contactEmail"),
    contactPhone: formString(fd, "contactPhone"),
    description: formString(fd, "description"),
    serviceCounties: formString(fd, "serviceCounties"),
    licenseType: formString(fd, "licenseType"),
    licenseNumber: formString(fd, "licenseNumber"),
  });
  const back = organizationId ? `/employer/org/edit?org=${organizationId}` : "/employer/org/edit";
  if (!parsed.success) redirect(`${back}?error=invalid_input`);
  const counties = parseCounties(parsed.data.serviceCounties);
  if (!counties) redirect(`${back}?error=invalid_input`);

  const supabase = await createClient();
  const meta = await requestMeta();
  const args = {
    p_name: parsed.data.name,
    p_org_type: parsed.data.orgType,
    p_website: parsed.data.website || null,
    p_contact_email: parsed.data.contactEmail || null,
    p_contact_phone: parsed.data.contactPhone || null,
    p_description: parsed.data.description || null,
    p_service_counties: counties,
    p_bsis_license_type: parsed.data.licenseType || null,
    p_bsis_license_number: parsed.data.licenseNumber || null,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  };

  let orgId = organizationId;
  if (orgId) {
    if (!ctx.orgMemberships.some((membership) => membership.organization_id === orgId && membership.role === "owner_admin")) {
      redirect("/forbidden");
    }
    const { error } = await supabase.rpc("update_organization", { p_org: orgId, ...args });
    if (error) {
      console.error("organization.update_failed", error.code);
      redirect(`${back}?error=${employerErrorCode(error.message)}`);
    }
  } else {
    const { data, error } = await supabase.rpc("create_organization", args);
    if (error || !data) {
      console.error("organization.create_failed", error?.code);
      redirect(`${back}?error=${employerErrorCode(error?.message)}`);
    }
    orgId = data;
  }

  const logo = fd.get("logo");
  const previous = formString(fd, "currentLogo");
  if (logo instanceof File && logo.size > 0) {
    const path = await uploadOrgLogo(supabase, orgId, logo);
    if (!path) redirect(orgPath(orgId, "error=upload_failed"));
    const { error } = await supabase.rpc("set_organization_logo", {
      p_org: orgId,
      p_path: path,
      p_user_agent: meta.user_agent,
      p_request_id: meta.request_id,
      p_ip: meta.ip_address,
    });
    if (error) {
      console.error("organization.logo_failed", error.code);
      redirect(orgPath(orgId, "error=upload_failed"));
    }
    if (previous && previous !== path) await supabase.storage.from("org-logos").remove([previous]);
  } else if (formString(fd, "clearLogo") === "yes" && previous) {
    const { error } = await supabase.rpc("set_organization_logo", {
      p_org: orgId,
      p_path: null,
      p_user_agent: meta.user_agent,
      p_request_id: meta.request_id,
      p_ip: meta.ip_address,
    });
    if (error) redirect(orgPath(orgId, "error=upload_failed"));
    await supabase.storage.from("org-logos").remove([previous]);
  }

  redirect(orgPath(orgId, organizationId ? "notice=saved" : "notice=created"));
}

export async function submitOrganizationVerification(fd: FormData) {
  const ctx = await requireArea("employer");
  const orgId = formString(fd, "organizationId");
  if (!ctx.orgMemberships.some((membership) => membership.organization_id === orgId && membership.role === "owner_admin")) {
    redirect("/forbidden");
  }
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("submit_organization_verification", {
    p_org: orgId,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) {
    console.error("organization.submit_failed", error.code);
    redirect(orgPath(orgId, `error=${employerErrorCode(error.message)}`));
  }
  redirect(orgPath(orgId, "notice=submitted"));
}
