import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  authorizeArea,
  deriveRoles,
  hasAnyRole,
  type Area,
  type OrgMemberRole,
  type ProfileFacts,
  type Role,
} from "@/lib/auth/roles";

export interface SessionContext {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  profile: ProfileFacts;
  roles: Role[];
  orgMemberships: { organization_id: string; role: OrgMemberRole }[];
}

/** Resolves identity + roles server-side from verified JWT and RLS-bound reads. */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from("profiles")
      .select("account_type, platform_role, status, display_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("organization_members").select("organization_id, role").eq("user_id", user.id),
  ]);
  if (!profile) return null; // fail closed

  const facts: ProfileFacts = {
    account_type: profile.account_type,
    platform_role: profile.platform_role,
    status: profile.status,
  };
  const orgMemberships = (memberships ?? []) as SessionContext["orgMemberships"];
  return {
    userId: user.id,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    displayName: profile.display_name,
    profile: facts,
    roles: deriveRoles(facts, orgMemberships.map((m) => m.role)),
    orgMemberships,
  };
});

export async function requireUser(nextPath = "/dashboard"): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!ctx.emailVerified) redirect("/verify-email");
  if (ctx.profile.status === "suspended" || ctx.profile.status === "deactivated") redirect("/account-inactive");
  return ctx;
}

export async function requireArea(area: Area): Promise<SessionContext> {
  const ctx = await requireUser(`/${area}`);
  const decision = authorizeArea(area, ctx.profile, ctx.roles);
  if (decision === "needs_account_type") redirect("/account-type");
  if (decision === "inactive") redirect("/account-inactive");
  if (decision !== "allow") redirect("/forbidden");
  return ctx;
}

export async function requireRole(anyOf: Role[], nextPath = "/dashboard"): Promise<SessionContext> {
  const ctx = await requireUser(nextPath);
  if (!hasAnyRole(ctx.roles, anyOf)) redirect("/forbidden");
  return ctx;
}
