import { z } from "zod";
import { SECURITY_CATEGORY_CODES } from "@/lib/workers/categories";
import { dollarsToCents } from "@/lib/workers/validation";
import { JOB_TYPE_CODES, PAY_TYPE_CODES, RECURRENCE_DAY_CODES, placeLooksPublic, recurrenceRule, type JobTypeCode, type PayTypeCode } from "./constants";
import { pacificWallTimeToIso } from "./time";

const money = z.string().trim().regex(/^$|^\d{1,5}(\.\d{1,2})?$/);
const day = z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^$|^\d{2}:\d{2}$/);

export const jobFormSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(10000),
  jobType: z.enum(JOB_TYPE_CODES),
  category: z.enum(SECURITY_CATEGORY_CODES),
  armed: z.boolean(),
  urgency: z.enum(["normal", "priority", "urgent"]),
  city: z.string().trim().max(80),
  county: z.string().trim().max(80),
  postalCode: z.string().trim().regex(/^$|^\d{5}(-\d{4})?$/),
  siteAddress: z.string().trim().max(300),
  startDate: day,
  startTime: clock,
  endDate: day,
  endTime: clock,
  recurrenceDays: z.array(z.enum(RECURRENCE_DAY_CODES)).max(7),
  payType: z.enum(PAY_TYPE_CODES),
  payMin: money,
  payMax: money,
  workersNeeded: z.coerce.number().int().min(1).max(500),
  minYears: z.union([z.literal(""), z.coerce.number().int().min(0).max(70)]),
  uniformNotes: z.string().trim().max(2000),
  vehicleRequired: z.boolean(),
  equipmentNotes: z.string().trim().max(2000),
  deadlineDate: day,
  deadlineTime: clock,
  credentialTypeIds: z.array(z.string().uuid()).max(20),
  intent: z.enum(["draft", "publish"]),
});

export type JobFormInput = z.infer<typeof jobFormSchema>;

export interface JobWrite {
  title: string;
  description: string;
  job_type: JobTypeCode;
  category: JobFormInput["category"];
  is_armed: boolean;
  urgency: JobFormInput["urgency"];
  city: string | null;
  county: string | null;
  postal_code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  recurrence_rule: string | null;
  pay_type: PayTypeCode;
  pay_min_cents: number | null;
  pay_max_cents: number | null;
  workers_needed: number;
  min_years_experience: number | null;
  uniform_notes: string | null;
  vehicle_required: boolean;
  equipment_notes: string | null;
  application_deadline: string | null;
  site_address: string | null;
  credential_type_ids: string[];
  intent: "draft" | "publish";
}

function instant(date: string, time: string): string | null | "invalid" {
  if (!date && !time) return null;
  if (!date || !time) return "invalid";
  return pacificWallTimeToIso(date, time) ?? "invalid";
}

export function jobWriteFromForm(input: JobFormInput): JobWrite | null {
  if (!placeLooksPublic(input.city) || !placeLooksPublic(input.county)) return null;
  const starts = instant(input.startDate, input.startTime);
  const ends = instant(input.endDate, input.endTime);
  const deadline = instant(input.deadlineDate, input.deadlineTime);
  if (starts === "invalid" || ends === "invalid" || deadline === "invalid") return null;
  if (starts && ends && ends <= starts) return null;

  const payMin = input.payMin ? dollarsToCents(input.payMin) : null;
  const payMax = input.payType === "flat" || !input.payMax ? null : dollarsToCents(input.payMax);
  if (input.payMin && payMin == null) return null;
  if (input.payMax && input.payType !== "flat" && payMax == null) return null;
  if (payMin != null && payMax != null && payMax < payMin) return null;

  const rule = input.jobType === "recurring" ? recurrenceRule(input.recurrenceDays) : null;
  if (input.jobType === "recurring" && input.recurrenceDays.length > 0 && !rule) return null;

  const ids = [...new Set(input.credentialTypeIds)];
  return {
    title: input.title,
    description: input.description,
    job_type: input.jobType,
    category: input.category,
    is_armed: input.armed,
    urgency: input.urgency,
    city: input.city || null,
    county: input.county || null,
    postal_code: input.postalCode || null,
    starts_at: starts,
    ends_at: ends,
    recurrence_rule: rule,
    pay_type: input.payType,
    pay_min_cents: payMin,
    pay_max_cents: payMax,
    workers_needed: input.workersNeeded,
    min_years_experience: input.minYears === "" ? null : input.minYears,
    uniform_notes: input.uniformNotes || null,
    vehicle_required: input.vehicleRequired,
    equipment_notes: input.equipmentNotes || null,
    application_deadline: deadline,
    site_address: input.siteAddress || null,
    credential_type_ids: ids,
    intent: input.intent,
  };
}

/** Same gate as app.job_post_complete, used before calling transition_job. */
export function jobReadyToPublish(job: JobWrite): boolean {
  if (job.title.trim().length < 3 || job.description.trim().length < 20) return false;
  if (!job.city || job.city.trim().length < 2 || !placeLooksPublic(job.city)) return false;
  if (job.county && !placeLooksPublic(job.county)) return false;
  if (job.pay_min_cents == null || job.pay_min_cents < 0) return false;
  if (job.pay_type === "flat" && job.pay_max_cents != null) return false;
  if (job.workers_needed < 1) return false;
  if (job.job_type === "single_shift" || job.job_type === "multi_day") {
    if (!job.starts_at || !job.ends_at || job.ends_at <= job.starts_at) return false;
  }
  if (job.job_type === "single_shift" && job.starts_at && job.ends_at) {
    const hours = (Date.parse(job.ends_at) - Date.parse(job.starts_at)) / 36e5;
    if (hours > 36) return false;
  }
  if (job.job_type === "recurring") {
    if (!job.starts_at || !job.recurrence_rule) return false;
  }
  if ((job.job_type === "contract" || job.job_type === "part_time" || job.job_type === "full_time") && (job.starts_at === null) !== (job.ends_at === null)) {
    return false;
  }
  return true;
}

export const JOB_COLUMNS =
  "id, organization_id, created_by, title, description, job_type, category, is_armed, status, urgency, city, county, postal_code, starts_at, ends_at, recurrence_rule, pay_type, pay_min_cents, pay_max_cents, workers_needed, min_years_experience, uniform_notes, vehicle_required, equipment_notes, application_deadline, published_at, created_at";

export function compensationLine(payType: string, minCents: number | null, maxCents: number | null): string {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  if (minCents == null) return "Pay not set";
  if (payType === "hourly") return maxCents != null ? `${money(minCents)}–${money(maxCents)} / hour` : `${money(minCents)} / hour`;
  if (payType === "flat") return `${money(minCents)} flat`;
  return maxCents != null ? `${money(minCents)}–${money(maxCents)} estimated` : `${money(minCents)} estimated`;
}
