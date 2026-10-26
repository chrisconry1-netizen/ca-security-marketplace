export const JOB_TYPES = [
  { code: "single_shift", label: "Single shift" },
  { code: "multi_day", label: "Multi-day" },
  { code: "recurring", label: "Recurring" },
  { code: "contract", label: "Contract" },
  { code: "part_time", label: "Part time" },
  { code: "full_time", label: "Full time" },
] as const;

export const PAY_TYPES = [
  { code: "hourly", label: "Hourly" },
  { code: "flat", label: "Flat amount" },
  { code: "salary", label: "Salary" },
  { code: "estimated", label: "Estimated" },
] as const;

export const URGENCIES = [
  { code: "normal", label: "Normal" },
  { code: "priority", label: "Priority" },
  { code: "urgent", label: "Urgent" },
] as const;

export const SHIFT_PERIODS = [
  { code: "day", label: "Day (6:00–14:00)" },
  { code: "swing", label: "Swing (14:00–22:00)" },
  { code: "night", label: "Night (22:00–6:00)" },
] as const;

export const ORG_TYPES = [
  { code: "ppo", label: "Private patrol operator (PPO)" },
  { code: "private_patrol_operator_branch", label: "PPO branch" },
  { code: "proprietary_security_employer", label: "Proprietary security employer" },
  { code: "event_company", label: "Event company" },
  { code: "property_management", label: "Property management" },
  { code: "hospital", label: "Hospital" },
  { code: "school", label: "School" },
  { code: "retail", label: "Retail" },
  { code: "corporate", label: "Corporate" },
  { code: "government", label: "Government" },
  { code: "other", label: "Other" },
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
  "id, organization_id, title, description, job_type, category, is_armed, status, urgency, city, county, postal_code, approx_lat, approx_lng, shift_period, starts_at, ends_at, pay_type, pay_min_cents, pay_max_cents, workers_needed, min_years_experience, uniform_notes, vehicle_required, equipment_notes, application_deadline, published_at";

export const PAY_DISCLAIMER = "Pay is entered by the employing organization. This marketplace does not set the wage or employ the worker.";
export const HIRING_DISCLAIMER = "The organization named on this shift is the employer. Accepting an offer records that you and they agreed to the assignment. It does not make you an employee of this marketplace.";
export const LOCATION_DISCLAIMER = "Distance uses an approximate city or ZIP point, rounded to about a kilometer. The work-site address is shown after you accept an offer.";
