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
