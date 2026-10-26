import { looksLikeStreetAddress } from "@/lib/workers/validation";

export const JOB_TYPES = [
  { code: "single_shift", label: "Single shift" },
  { code: "multi_day", label: "Multi-day" },
  { code: "recurring", label: "Recurring" },
  { code: "contract", label: "Contract" },
  { code: "part_time", label: "Part-time" },
  { code: "full_time", label: "Full-time" },
] as const;

export const JOB_TYPE_CODES = JOB_TYPES.map((item) => item.code) as [
  (typeof JOB_TYPES)[number]["code"],
  ...(typeof JOB_TYPES)[number]["code"][],
];

export type JobTypeCode = (typeof JOB_TYPES)[number]["code"];

export const PAY_TYPES = [
  { code: "hourly", label: "Hourly rate" },
  { code: "flat", label: "Flat rate" },
  { code: "estimated", label: "Estimated compensation" },
] as const;

export const PAY_TYPE_CODES = PAY_TYPES.map((item) => item.code) as [
  (typeof PAY_TYPES)[number]["code"],
  ...(typeof PAY_TYPES)[number]["code"][],
];

export type PayTypeCode = (typeof PAY_TYPES)[number]["code"];

export const URGENCIES = [
  { code: "normal", label: "Normal" },
  { code: "priority", label: "Priority" },
  { code: "urgent", label: "Urgent" },
] as const;

export const RECURRENCE_DAYS = [
  { code: "SU", label: "Sunday" },
  { code: "MO", label: "Monday" },
  { code: "TU", label: "Tuesday" },
  { code: "WE", label: "Wednesday" },
  { code: "TH", label: "Thursday" },
  { code: "FR", label: "Friday" },
  { code: "SA", label: "Saturday" },
] as const;

export const RECURRENCE_DAY_CODES = RECURRENCE_DAYS.map((item) => item.code) as [
  (typeof RECURRENCE_DAYS)[number]["code"],
  ...(typeof RECURRENCE_DAYS)[number]["code"][],
];

const JOB_TYPE_LABELS = new Map<string, string>(JOB_TYPES.map((item) => [item.code, item.label]));

export function jobTypeLabel(code: string): string {
  return JOB_TYPE_LABELS.get(code) ?? code;
}

export function recurrenceRule(codes: readonly string[]): string | null {
  const allowed = new Set<string>(RECURRENCE_DAY_CODES);
  if (codes.length === 0 || codes.some((code) => !allowed.has(code))) return null;
  const ordered = RECURRENCE_DAY_CODES.filter((code) => codes.includes(code));
  if (ordered.length !== new Set(codes).size) return null;
  return `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`;
}

export function recurrenceDays(rule: string | null | undefined): string[] {
  if (!rule) return [];
  const match = rule.match(/^FREQ=WEEKLY;BYDAY=([A-Z,]+)$/);
  if (!match?.[1]) return [];
  return match[1].split(",").filter((code) => (RECURRENCE_DAY_CODES as readonly string[]).includes(code));
}

export function placeLooksPublic(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return !looksLikeStreetAddress(trimmed);
}

export { ORG_TYPES } from "@/lib/orgs/constants";

export const SHIFT_PERIODS = [
  { code: "day", label: "Day (6:00–14:00)" },
  { code: "swing", label: "Swing (14:00–22:00)" },
  { code: "night", label: "Night (22:00–6:00)" },
] as const;

export const ARMED_CREDENTIAL_CODES = ["ca_guard_registration", "ca_exposed_firearm_permit"] as const;

export const APPLICATION_LABELS: Record<string, string> = {
  submitted: "Submitted",
  reviewing: "Reviewing",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offered: "Offered",
  accepted: "Accepted",
  declined: "Declined",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const EMPLOYER_ACTION_LABELS: Record<string, string> = {
  reviewing: "Mark reviewing",
  shortlisted: "Shortlist",
  interview: "Mark interview",
  offered: "Offer",
  rejected: "Reject",
};

export const PAGE_SIZE = 20;

export const PUBLIC_JOB_COLUMNS =
  "id, organization_id, title, description, job_type, category, is_armed, status, urgency, city, county, postal_code, approx_lat, approx_lng, shift_period, starts_at, ends_at, pay_type, pay_min_cents, pay_max_cents, workers_needed, min_years_experience, uniform_notes, vehicle_required, equipment_notes, application_deadline, published_at, requires_off_duty_le";

export const PAY_DISCLAIMER = "Pay is entered by the employing organization. This marketplace does not set the wage or employ the worker.";
export const HIRING_DISCLAIMER = "The organization named on this shift is the employer. Accepting an offer records that you and they agreed to the assignment. It does not make you an employee of this marketplace.";
export const LOCATION_DISCLAIMER = "Distance uses an approximate city or ZIP point, rounded to about a kilometer. The work-site address is shown after you accept an offer.";
