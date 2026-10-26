/**
 * Role model (pure; unit-tested). Source of truth is the database:
 *   profiles.account_type  -> worker | employer | staff
 *   profiles.platform_role -> user | moderator | admin | super_admin
 *   organization_members.role -> owner_admin | manager | recruiter_dispatcher
 * These functions only interpret data the SERVER read with the user's session.
 */
export const ROLES = [
  "worker",
  "employer",
  "organization_admin",
  "organization_manager",
  "organization_recruiter",
  "moderator",
  "admin",
  "super_admin",
] as const;
export type Role = (typeof ROLES)[number];

export type AccountType = "worker" | "employer" | "staff";
export type PlatformRole = "user" | "moderator" | "admin" | "super_admin";
export type AccountStatus = "active" | "pending_verification" | "suspended" | "deactivated";
export type OrgMemberRole = "owner_admin" | "manager" | "recruiter_dispatcher";

export interface ProfileFacts {
  account_type: AccountType | null;
  platform_role: PlatformRole;
  status: AccountStatus;
}

const ORG_ROLE_MAP: Record<OrgMemberRole, Role> = {
  owner_admin: "organization_admin",
  manager: "organization_manager",
  recruiter_dispatcher: "organization_recruiter",
};

export function deriveRoles(profile: ProfileFacts, orgRoles: OrgMemberRole[] = []): Role[] {
  const roles = new Set<Role>();
  if (profile.account_type === "worker") roles.add("worker");
  if (profile.account_type === "employer") roles.add("employer");
  if (profile.platform_role !== "user") roles.add(profile.platform_role);
  for (const r of orgRoles) {
    const mapped = ORG_ROLE_MAP[r];
    if (mapped) roles.add(mapped);
  }
  return ROLES.filter((r) => roles.has(r));
}

export const STAFF_ROLES: Role[] = ["moderator", "admin", "super_admin"];
export const EMPLOYER_ROLES: Role[] = [
  "employer",
  "organization_admin",
  "organization_manager",
  "organization_recruiter",
];

export type Area = "worker" | "employer" | "admin";
export type AreaDecision = "allow" | "needs_account_type" | "inactive" | "forbidden";

export function hasAnyRole(roles: readonly Role[], anyOf: readonly Role[]): boolean {
  return anyOf.some((r) => roles.includes(r));
}

export function authorizeArea(area: Area, profile: ProfileFacts, roles: readonly Role[]): AreaDecision {
  if (profile.status === "suspended" || profile.status === "deactivated") return "inactive";
  if (area === "admin") return hasAnyRole(roles, STAFF_ROLES) ? "allow" : "forbidden";
  if (profile.account_type === null && !hasAnyRole(roles, STAFF_ROLES)) return "needs_account_type";
  if (area === "worker") return roles.includes("worker") ? "allow" : "forbidden";
  return hasAnyRole(roles, EMPLOYER_ROLES) ? "allow" : "forbidden";
}

/** Where /dashboard sends a signed-in user. */
export function homePathFor(profile: ProfileFacts, roles: readonly Role[]): string {
  if (profile.status === "suspended" || profile.status === "deactivated") return "/account-inactive";
  if (hasAnyRole(roles, STAFF_ROLES)) return "/admin";
  if (profile.account_type === null) return "/account-type";
  if (roles.includes("worker")) return "/worker";
  if (hasAnyRole(roles, EMPLOYER_ROLES)) return "/employer";
  return "/account-type";
}
