import { FORBIDDEN_PROMPT_KEYS, GROK_PROMPT_FIELDS, REASON_CODES, type ReasonCode } from "./constants";
import { deterministicScore } from "./score";

export interface VerifiedCredentialFact {
  code: string;
  name: string;
  expiresOn: string | null;
}

/** Server-built fact. Extra keys from the database are ignored by the parser. */
export interface MatchFact {
  jobId: string;
  workerId: string;
  title: string;
  category: string;
  armed: boolean;
  jobCity: string | null;
  jobCounty: string | null;
  shiftPeriod: string | null;
  payType: string;
  payMinCents: number | null;
  payMaxCents: number | null;
  urgency: string;
  organizationName: string | null;
  distanceMiles: number;
  radiusMiles: number;
  yearsExperience: number | null;
  minYears: number | null;
  hasTransportation: boolean | null;
  vehicleRequired: boolean;
  categoryMatch: boolean;
  payMeetsMinimum: boolean;
  availabilityKind: "covers_shift" | "open_schedule";
  guardCardActive: boolean;
  firearmPermitActive: boolean;
  epTrainingActive: boolean;
  offDutyLeApproved: boolean;
  requiresOffDutyLe: boolean;
  requiresEp: boolean;
  ppoOk: boolean;
  orgVerified: boolean;
  mandatoryCredentialsMet: boolean;
  displayName: string | null;
  workerCity: string | null;
  workerCounty: string | null;
  credentials: VerifiedCredentialFact[];
}

export interface GrokCandidate {
  id: string;
  distance_miles: number;
  radius_miles: number;
  years_experience: number | null;
  min_years_experience: number | null;
  category_match: boolean;
  pay_type: string;
  pay_min_cents: number | null;
  pay_meets_minimum: boolean;
  urgency: string;
  shift_period: string | null;
  is_armed: boolean;
  vehicle_required: boolean;
  has_transportation: boolean | null;
  availability_kind: "covers_shift" | "open_schedule";
  guard_card_active: boolean;
  firearm_permit_active: boolean;
  ep_training_active: boolean;
  off_duty_le_approved: boolean;
  ppo_requirement_met: boolean;
  mandatory_credentials_met: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function flag(value: unknown): boolean {
  return value === true;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

export function parseMatchFact(value: unknown): MatchFact | null {
  const row = asRecord(value);
  if (!row) return null;
  const jobId = uuid(row.job_id);
  const workerId = uuid(row.worker_id);
  const distance = num(row.distance_miles);
  const radius = num(row.radius_miles);
  const title = text(row.title);
  const availability = row.availability_kind === "open_schedule" || row.availability_kind === "covers_shift" ? row.availability_kind : null;
  if (!jobId || !workerId || distance == null || radius == null || !title || !availability) return null;
  if (!flag(row.guard_card_active) || !flag(row.org_verified) || !flag(row.mandatory_credentials_met) || !flag(row.ppo_ok)) return null;
  const credentials: VerifiedCredentialFact[] = [];
  if (Array.isArray(row.credentials)) {
    for (const item of row.credentials) {
      const cred = asRecord(item);
      if (!cred || typeof cred.code !== "string" || typeof cred.name !== "string") continue;
      credentials.push({
        code: cred.code,
        name: cred.name,
        expiresOn: typeof cred.expires_on === "string" ? cred.expires_on : null,
      });
    }
  }
  return {
    jobId,
    workerId,
    title,
    category: text(row.category) ?? "",
    armed: flag(row.is_armed),
    jobCity: text(row.job_city),
    jobCounty: text(row.job_county),
    shiftPeriod: text(row.shift_period),
    payType: text(row.pay_type) ?? "",
    payMinCents: num(row.pay_min_cents),
    payMaxCents: num(row.pay_max_cents),
    urgency: text(row.urgency) ?? "normal",
    organizationName: text(row.organization_name),
    distanceMiles: distance,
    radiusMiles: radius,
    yearsExperience: num(row.years_experience),
    minYears: num(row.min_years_experience),
    hasTransportation: row.has_transportation === true ? true : row.has_transportation === false ? false : null,
    vehicleRequired: flag(row.vehicle_required),
    categoryMatch: flag(row.category_match),
    payMeetsMinimum: flag(row.pay_meets_minimum),
    availabilityKind: availability,
    guardCardActive: true,
    firearmPermitActive: flag(row.firearm_permit_active),
    epTrainingActive: flag(row.ep_training_active),
    offDutyLeApproved: flag(row.off_duty_le_approved),
    requiresOffDutyLe: flag(row.requires_off_duty_le),
    requiresEp: flag(row.requires_ep),
    ppoOk: true,
    orgVerified: true,
    mandatoryCredentialsMet: true,
    displayName: text(row.display_name),
    workerCity: text(row.worker_city),
    workerCounty: text(row.worker_county),
    credentials,
  };
}

export function supportedReasonCodes(fact: MatchFact): ReasonCode[] {
  const codes: ReasonCode[] = [
    "GUARD_CARD_ACTIVE",
    "ORG_VERIFIED",
    "AVAILABLE",
    "WITHIN_RADIUS",
    "NOT_BLOCKED",
    "NOT_APPLIED",
    "MANDATORY_CREDENTIALS",
  ];
  if (fact.armed && fact.firearmPermitActive) codes.push("FIREARM_PERMIT_ACTIVE");
  if (fact.requiresEp && fact.epTrainingActive) codes.push("EP_TRAINING_ACTIVE");
  if (fact.requiresOffDutyLe && fact.offDutyLeApproved) codes.push("OFF_DUTY_LE_APPROVED");
  if (fact.armed && fact.ppoOk) codes.push("PPO_VERIFIED");
  if (fact.categoryMatch) codes.push("CATEGORY_MATCH");
  if (fact.yearsExperience != null) codes.push("EXPERIENCE_YEARS");
  if (fact.payMeetsMinimum) codes.push("PAY_MEETS_MINIMUM");
  if (fact.vehicleRequired && fact.hasTransportation) codes.push("TRANSPORTATION");
  if (fact.urgency === "urgent" || fact.urgency === "priority") codes.push("URGENCY");
  return codes;
}

export function toGrokCandidate(fact: MatchFact, direction: "jobs_for_worker" | "workers_for_job"): GrokCandidate {
  return {
    id: direction === "jobs_for_worker" ? fact.jobId : fact.workerId,
    distance_miles: fact.distanceMiles,
    radius_miles: fact.radiusMiles,
    years_experience: fact.yearsExperience,
    min_years_experience: fact.minYears,
    category_match: fact.categoryMatch,
    pay_type: fact.payType,
    pay_min_cents: fact.payMinCents,
    pay_meets_minimum: fact.payMeetsMinimum,
    urgency: fact.urgency,
    shift_period: fact.shiftPeriod,
    is_armed: fact.armed,
    vehicle_required: fact.vehicleRequired,
    has_transportation: fact.hasTransportation,
    availability_kind: fact.availabilityKind,
    guard_card_active: fact.guardCardActive,
    firearm_permit_active: fact.firearmPermitActive,
    ep_training_active: fact.epTrainingActive,
    off_duty_le_approved: fact.offDutyLeApproved,
    ppo_requirement_met: fact.ppoOk,
    mandatory_credentials_met: fact.mandatoryCredentialsMet,
  };
}

export function grokCandidateKeys(candidate: GrokCandidate): string[] {
  return Object.keys(candidate).sort();
}

export function promptFieldNamesMatch(candidate: GrokCandidate): boolean {
  const keys = grokCandidateKeys(candidate);
  const expected = [...GROK_PROMPT_FIELDS].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

const forbidden = new Set<string>(FORBIDDEN_PROMPT_KEYS);

export function forbiddenPromptKey(value: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown): string | null => {
    if (!node || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (forbidden.has(key.toLowerCase())) return key;
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(value);
}

export function scoreFact(fact: MatchFact): number {
  return deterministicScore({
    categoryMatch: fact.categoryMatch,
    distanceMiles: fact.distanceMiles,
    radiusMiles: fact.radiusMiles,
    payMeetsMinimum: fact.payMeetsMinimum,
    yearsExperience: fact.yearsExperience,
    minYears: fact.minYears,
    urgency: fact.urgency,
    vehicleRequired: fact.vehicleRequired,
    hasTransportation: fact.hasTransportation,
  });
}

export function isReasonCode(value: string): value is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(value);
}
