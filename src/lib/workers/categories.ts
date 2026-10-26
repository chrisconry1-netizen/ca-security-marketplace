/** Closed list. Codes match public.security_category. Labels are the product names. */
export const SECURITY_CATEGORIES = [
  { code: "unarmed_security", label: "Unarmed" },
  { code: "armed_security", label: "Armed" },
  { code: "executive_protection", label: "Executive Protection" },
  { code: "event_security", label: "Event" },
  { code: "corporate_security", label: "Corporate" },
  { code: "residential_security", label: "Residential" },
  { code: "hospital_security", label: "Hospital" },
  { code: "school_security", label: "School" },
  { code: "retail_security", label: "Retail" },
  { code: "loss_prevention", label: "Loss Prevention" },
  { code: "patrol", label: "Patrol" },
  { code: "mobile_patrol", label: "Mobile Patrol" },
  { code: "close_protection", label: "Close Protection" },
  { code: "plainclothes", label: "Plainclothes" },
  { code: "supervisor", label: "Supervisor" },
  { code: "security_manager", label: "Security Manager" },
] as const;

export const SECURITY_CATEGORY_CODES = SECURITY_CATEGORIES.map((c) => c.code) as [
  (typeof SECURITY_CATEGORIES)[number]["code"],
  ...(typeof SECURITY_CATEGORIES)[number]["code"][],
];

export type SecurityCategoryCode = (typeof SECURITY_CATEGORIES)[number]["code"];

const LABELS = new Map<string, string>(SECURITY_CATEGORIES.map((c) => [c.code, c.label]));

export function categoryLabel(code: string): string {
  return LABELS.get(code) ?? code;
}

export const LANGUAGES = [
  "English",
  "Spanish",
  "Mandarin",
  "Cantonese",
  "Vietnamese",
  "Tagalog",
  "Korean",
  "Armenian",
  "Arabic",
  "Russian",
  "Farsi",
  "Punjabi",
  "Hindi",
  "ASL",
] as const;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const CREDENTIAL_TYPE_CODES = [
  "ca_guard_registration",
  "ca_exposed_firearm_permit",
  "ca_baton_permit",
  "cpr_aed",
  "first_aid",
  "taser",
  "oc",
  "ep_training",
  "drivers_license",
  "other",
] as const;

export const VERIFICATION_METHODS = [
  { code: "document_review", label: "Document review" },
  { code: "bsis_public_lookup", label: "BSIS public lookup (recorded by a person)" },
  { code: "issuer_contact", label: "Issuer contact" },
  { code: "third_party_api", label: "Third-party source (recorded by a person)" },
  { code: "other", label: "Other" },
] as const;
