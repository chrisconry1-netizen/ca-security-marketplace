import { SECURITY_CATEGORY_CODES } from "@/lib/workers/categories";
import { dollarsToCents } from "@/lib/workers/validation";
import { JOB_TYPES, PAGE_SIZE, SHIFT_PERIODS } from "./constants";

export interface JobSearchInput {
  city: string;
  county: string;
  near: string;
  radius: string;
  pay: string;
  date: string;
  shift: string;
  from: string;
  to: string;
  category: string;
  armed: string;
  credential: string;
  years: string;
  employer: string;
  jobType: string;
  eligible: boolean;
  page: number;
}

function one(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim();
}

export function parseJobSearch(sp: Record<string, string | string[] | undefined>): JobSearchInput {
  const page = Number(one(sp.page));
  return {
    city: one(sp.city).slice(0, 80),
    county: one(sp.county).slice(0, 80),
    near: one(sp.near).slice(0, 80),
    radius: one(sp.radius),
    pay: one(sp.pay),
    date: one(sp.date),
    shift: one(sp.shift),
    from: one(sp.from),
    to: one(sp.to),
    category: one(sp.category),
    armed: one(sp.armed),
    credential: one(sp.credential),
    years: one(sp.years),
    employer: one(sp.employer).slice(0, 200),
    jobType: one(sp.jobType),
    eligible: one(sp.eligible) === "1",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 500) : 1,
  };
}

export function searchQuery(input: JobSearchInput, overrides: Partial<JobSearchInput> = {}): string {
  const value = { ...input, ...overrides };
  const params = new URLSearchParams();
  const entries: [string, string][] = [
    ["city", value.city],
    ["county", value.county],
    ["near", value.near],
    ["radius", value.radius],
    ["pay", value.pay],
    ["date", value.date],
    ["shift", value.shift],
    ["from", value.from],
    ["to", value.to],
    ["category", value.category],
    ["armed", value.armed],
    ["credential", value.credential],
    ["years", value.years],
    ["employer", value.employer],
    ["jobType", value.jobType],
  ];
  for (const [key, item] of entries) if (item) params.set(key, item);
  if (value.eligible) params.set("eligible", "1");
  if (value.page > 1) params.set("page", String(value.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

const clock = /^\d{2}:\d{2}$/;
const day = /^\d{4}-\d{2}-\d{2}$/;

export function toSearchRpc(input: JobSearchInput, origin: { lat: number; lng: number } | null) {
  const radius = Number(input.radius);
  const years = Number(input.years);
  const useRadius = origin != null && Number.isFinite(radius) && radius > 0;
  const windowOk = clock.test(input.from) && clock.test(input.to);
  return {
    args: {
      p_lat: useRadius ? origin.lat : null,
      p_lng: useRadius ? origin.lng : null,
      p_radius_miles: useRadius ? Math.min(radius, 500) : null,
      p_city: input.city || null,
      p_county: input.county || null,
      p_pay_min_cents: dollarsToCents(input.pay),
      p_on_date: day.test(input.date) ? input.date : null,
      p_shift: SHIFT_PERIODS.some((item) => item.code === input.shift) ? input.shift : null,
      p_window_start: windowOk ? input.from : null,
      p_window_end: windowOk ? input.to : null,
      p_category: (SECURITY_CATEGORY_CODES as readonly string[]).includes(input.category) ? input.category : null,
      p_armed: input.armed === "yes" ? true : input.armed === "no" ? false : null,
      p_credential_code: input.credential || null,
      p_min_years: Number.isInteger(years) && years >= 0 && years <= 70 ? years : null,
      p_organization_id: null,
      p_job_type: JOB_TYPES.some((item) => item.code === input.jobType) ? input.jobType : null,
      p_employer: input.employer || null,
      p_eligible_only: input.eligible,
      p_limit: PAGE_SIZE,
      p_offset: (input.page - 1) * PAGE_SIZE,
    },
    ignoredRadius: input.radius !== "" && !useRadius,
  };
}
