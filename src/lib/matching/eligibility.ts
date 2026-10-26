import { EP_CATEGORIES, PPO_ORG_TYPES } from "./constants";

export type AvailabilityKind = "covers_shift" | "open_schedule" | "unavailable";

/** Plain facts the filter reads. Callers supply server-loaded values only. */
export interface EligibilityInput {
  direction: "jobs_for_worker" | "workers_for_job";
  workerActive: boolean;
  searchable: boolean;
  jobStatus: string;
  jobExpired: boolean;
  jobFilled: boolean;
  alreadyApplied: boolean;
  blocked: boolean;
  guardCardActive: boolean;
  armed: boolean;
  firearmActive: boolean;
  mandatoryMissing: boolean;
  category: string;
  epActive: boolean;
  requiresOffDutyLe: boolean;
  offDutyLeApproved: boolean;
  orgVerified: boolean;
  orgType: string;
  distanceMiles: number | null;
  radiusMiles: number | null;
  availability: AvailabilityKind;
  payType: string;
  payMinCents: number | null;
  workerMinHourlyCents: number | null;
}

export function requiresEp(category: string): boolean {
  return (EP_CATEGORIES as readonly string[]).includes(category);
}

export function ppoRequirementMet(armed: boolean, orgVerified: boolean, orgType: string): boolean {
  if (!orgVerified) return false;
  if (!armed) return true;
  return (PPO_ORG_TYPES as readonly string[]).includes(orgType);
}

/**
 * Null when the pair may be ranked. A string is an internal reason, not user copy.
 * Mirrors app.match_fact. SQL remains the enforcement point.
 */
export function eligibilityFailure(input: EligibilityInput): string | null {
  if (!input.workerActive) return "inactive";
  if (input.direction === "workers_for_job" && !input.searchable) return "not_searchable";
  if (input.jobStatus !== "published") return "not_published";
  if (input.jobExpired || input.jobFilled) return "closed";
  if (input.alreadyApplied) return "already_applied";
  if (input.blocked) return "blocked";
  if (!input.guardCardActive) return "guard_card";
  if (input.armed && !input.firearmActive) return "firearm";
  if (input.mandatoryMissing) return "mandatory";
  if (requiresEp(input.category) && !input.epActive) return "ep";
  if (input.requiresOffDutyLe && !input.offDutyLeApproved) return "off_duty";
  if (!ppoRequirementMet(input.armed, input.orgVerified, input.orgType)) return "ppo";
  if (input.distanceMiles == null || input.radiusMiles == null) return "location";
  if (input.distanceMiles > input.radiusMiles) return "radius";
  if (input.availability === "unavailable") return "availability";
  if (
    input.payType === "hourly" &&
    input.workerMinHourlyCents != null &&
    (input.payMinCents == null || input.payMinCents < input.workerMinHourlyCents)
  ) {
    return "pay";
  }
  return null;
}

export function isEligible(input: EligibilityInput): boolean {
  return eligibilityFailure(input) === null;
}
