"use server";

import { redirect } from "next/navigation";
import { employerErrorCode } from "@/lib/employer/messages";
import { formString } from "@/lib/form";
import { ORG_MEMBER_ROLE_CODES } from "@/lib/orgs/constants";
import { inviteSchema } from "@/lib/orgs/validation";
import { createClient } from "@/lib/supabase/server";
import { requestMeta } from "@/server/audit/audit";
import { requireArea, requireUser } from "@/server/auth/guards";

export async function inviteMember(fd: FormData) {
  const ctx = await requireArea("employer");
  const parsed = inviteSchema.safeParse({
    organizationId: formString(fd, "organizationId"),
    email: formString(fd, "email"),
    role: formString(fd, "role"),
  });
  const orgId = formString(fd, "organizationId");
  const back = `/employer/team?org=${orgId}`;
  if (!parsed.success) redirect(`${back}&error=invalid_input`);
  if (!ctx.orgMemberships.some((membership) => membership.organization_id === parsed.data.organizationId && membership.role === "owner_admin")) {
    redirect("/forbidden");
  }
  const supabase = await createClient();
  const meta = await requestMeta();
  const { data, error } = await supabase.rpc("create_organization_invite", {
    p_org: parsed.data.organizationId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error || !data) {
    console.error("organization.invite_failed", error?.code);
    redirect(`${back}&error=${employerErrorCode(error?.message)}`);
  }
  redirect(`${back}&notice=invited&token=${encodeURIComponent(data)}`);
}

export async function revokeInvite(fd: FormData) {
  const ctx = await requireArea("employer");
  const orgId = formString(fd, "organizationId");
  const inviteId = formString(fd, "inviteId");
  if (!ctx.orgMemberships.some((membership) => membership.organization_id === orgId && membership.role === "owner_admin")) {
    redirect("/forbidden");
  }
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("revoke_organization_invite", {
    p_invite: inviteId,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) redirect(`/employer/team?org=${orgId}&error=${employerErrorCode(error.message)}`);
  redirect(`/employer/team?org=${orgId}&notice=revoked`);
}

export async function changeMemberRole(fd: FormData) {
  const ctx = await requireArea("employer");
  const orgId = formString(fd, "organizationId");
  const userId = formString(fd, "userId");
  const role = formString(fd, "role");
  if (!(ORG_MEMBER_ROLE_CODES as readonly string[]).includes(role)) redirect(`/employer/team?org=${orgId}&error=invalid_input`);
  if (!ctx.orgMemberships.some((membership) => membership.organization_id === orgId && membership.role === "owner_admin")) {
    redirect("/forbidden");
  }
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("change_org_member_role", {
    p_org: orgId,
    p_user: userId,
    p_role: role,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) redirect(`/employer/team?org=${orgId}&error=${employerErrorCode(error.message)}`);
  redirect(`/employer/team?org=${orgId}&notice=role_saved`);
}

export async function removeMember(fd: FormData) {
  const ctx = await requireArea("employer");
  const orgId = formString(fd, "organizationId");
  const userId = formString(fd, "userId");
  const mine = ctx.orgMemberships.some((membership) => membership.organization_id === orgId);
  const owner = ctx.orgMemberships.some((membership) => membership.organization_id === orgId && membership.role === "owner_admin");
  if (!mine || (!owner && userId !== ctx.userId)) redirect("/forbidden");
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("remove_org_member", {
    p_org: orgId,
    p_user: userId,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) redirect(`/employer/team?org=${orgId}&error=${employerErrorCode(error.message)}`);
  redirect(userId === ctx.userId ? "/employer?notice=removed" : `/employer/team?org=${orgId}&notice=removed`);
}

export async function acceptInvite(fd: FormData) {
  const token = formString(fd, "token");
  const back = `/employer/invites/accept?token=${encodeURIComponent(token)}`;
  const ctx = await requireUser(back);
  if (ctx.profile.account_type !== "employer") redirect(`${back}&error=employer_required`);
  const supabase = await createClient();
  const meta = await requestMeta();
  const { data, error } = await supabase.rpc("accept_organization_invite", {
    p_token: token,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error || !data) {
    console.error("organization.accept_failed", error?.code);
    redirect(`${back}&error=${employerErrorCode(error?.message)}`);
  }
  redirect(`/employer/org?org=${data}&notice=joined`);
}
