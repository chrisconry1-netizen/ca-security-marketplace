export const ORG_TYPES = [
  { code: "ppo", label: "Private patrol operator (PPO)" },
  { code: "private_patrol_operator_branch", label: "PPO branch" },
  { code: "proprietary_security_employer", label: "Proprietary private security employer" },
  { code: "event_company", label: "Event company" },
  { code: "property_management", label: "Property management" },
  { code: "hospital", label: "Hospital" },
  { code: "school", label: "School" },
  { code: "retail", label: "Retail" },
  { code: "corporate", label: "Corporate" },
  { code: "government", label: "Government" },
  { code: "other", label: "Other" },
] as const;

export const ORG_TYPE_CODES = ORG_TYPES.map((item) => item.code) as [
  (typeof ORG_TYPES)[number]["code"],
  ...(typeof ORG_TYPES)[number]["code"][],
];

export type OrgTypeCode = (typeof ORG_TYPES)[number]["code"];

export const LICENSE_REQUIRED_ORG_TYPES: readonly OrgTypeCode[] = [
  "ppo",
  "private_patrol_operator_branch",
  "proprietary_security_employer",
];

export const ORG_MEMBER_ROLES = [
  { code: "owner_admin", label: "Owner/Admin" },
  { code: "manager", label: "Manager" },
  { code: "recruiter_dispatcher", label: "Recruiter/Dispatcher" },
] as const;

export const ORG_MEMBER_ROLE_CODES = ORG_MEMBER_ROLES.map((item) => item.code) as [
  (typeof ORG_MEMBER_ROLES)[number]["code"],
  ...(typeof ORG_MEMBER_ROLES)[number]["code"][],
];

const ORG_LABELS = new Map<string, string>(ORG_TYPES.map((item) => [item.code, item.label]));
const ROLE_LABELS = new Map<string, string>(ORG_MEMBER_ROLES.map((item) => [item.code, item.label]));

export const ORG_COLUMNS =
  "id, name, org_type, website, contact_email, contact_phone_e164, description, logo_path, service_counties, verification_status, verified_at, created_by";

export function orgTypeLabel(code: string): string {
  return ORG_LABELS.get(code) ?? code;
}

export function orgRoleLabel(code: string): string {
  return ROLE_LABELS.get(code) ?? code;
}

export function licenseRequired(orgType: string): boolean {
  return (LICENSE_REQUIRED_ORG_TYPES as readonly string[]).includes(orgType);
}

export function parseCounties(input: string): string[] | null {
  const parts = input
    .split(/\n|,/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 40) return null;
  if (parts.some((part) => part.length > 80 || /[\u0000-\u001f]/.test(part))) return null;
  return parts;
}
