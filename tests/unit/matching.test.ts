import { describe, expect, it } from "vitest";
import { GROK_PROMPT_FIELDS } from "@/lib/matching/constants";
import { eligibilityFailure, type EligibilityInput } from "@/lib/matching/eligibility";
import { forbiddenPromptKey, promptFieldNamesMatch, supportedReasonCodes, toGrokCandidate, type MatchFact } from "@/lib/matching/facts";
import { buildGrokRequestBody, mergeRankOrder, parseGrokContent, validateGrokRankings } from "@/lib/matching/grok-output";
import { compareDeterministic, deterministicScore } from "@/lib/matching/score";

const base: EligibilityInput = {
  direction: "workers_for_job",
  workerActive: true,
  searchable: true,
  jobStatus: "published",
  jobExpired: false,
  jobFilled: false,
  alreadyApplied: false,
  blocked: false,
  guardCardActive: true,
  armed: false,
  firearmActive: false,
  mandatoryMissing: false,
  category: "unarmed_security",
  epActive: false,
  requiresOffDutyLe: false,
  offDutyLeApproved: false,
  orgVerified: true,
  orgType: "event_company",
  distanceMiles: 4,
  radiusMiles: 25,
  availability: "covers_shift",
  payType: "hourly",
  payMinCents: 2800,
  workerMinHourlyCents: 2000,
};

function fact(patch: Partial<MatchFact> = {}): MatchFact {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    workerId: "22222222-2222-4222-8222-222222222222",
    title: "Lobby",
    category: "unarmed_security",
    armed: false,
    jobCity: "Oakland",
    jobCounty: "Alameda",
    shiftPeriod: "day",
    payType: "hourly",
    payMinCents: 2800,
    payMaxCents: null,
    urgency: "normal",
    organizationName: "North Gate",
    distanceMiles: 4,
    radiusMiles: 25,
    yearsExperience: 5,
    minYears: 1,
    hasTransportation: true,
    vehicleRequired: false,
    categoryMatch: true,
    payMeetsMinimum: true,
    availabilityKind: "covers_shift",
    guardCardActive: true,
    firearmPermitActive: false,
    epTrainingActive: false,
    offDutyLeApproved: false,
    requiresOffDutyLe: false,
    requiresEp: false,
    ppoOk: true,
    orgVerified: true,
    mandatoryCredentialsMet: true,
    displayName: "Should Not Be Sent",
    workerCity: "Oakland",
    workerCounty: "Alameda",
    credentials: [{ code: "ca_guard_registration", name: "CA Guard Registration (BSIS)", expiresOn: "2028-01-15" }],
    ...patch,
  };
}

describe("eligibility filter", () => {
  it("accepts a pair that passes every hard check", () => {
    expect(eligibilityFailure(base)).toBeNull();
  });

  it("does not require search opt-in when the worker is asking for shifts", () => {
    expect(eligibilityFailure({ ...base, direction: "jobs_for_worker", searchable: false })).toBeNull();
  });

  it.each([
    ["inactive account", { workerActive: false }, "inactive"],
    ["hidden from employer search", { searchable: false }, "not_searchable"],
    ["unpublished shift", { jobStatus: "draft" }, "not_published"],
    ["expired shift", { jobExpired: true }, "closed"],
    ["filled shift", { jobFilled: true }, "closed"],
    ["existing application", { alreadyApplied: true }, "already_applied"],
    ["block", { blocked: true }, "blocked"],
    ["missing guard card", { guardCardActive: false }, "guard_card"],
    ["armed post without a firearm permit", { armed: true, firearmActive: false, orgType: "ppo" }, "firearm"],
    ["missing mandatory credential", { mandatoryMissing: true }, "mandatory"],
    ["executive protection without training", { category: "executive_protection", epActive: false }, "ep"],
    ["close protection without training", { category: "close_protection", epActive: false }, "ep"],
    ["off-duty post without approval", { requiresOffDutyLe: true, offDutyLeApproved: false }, "off_duty"],
    ["armed post at an unverified organization", { armed: true, firearmActive: true, orgVerified: false, orgType: "ppo" }, "ppo"],
    ["armed post outside a PPO or proprietary employer", { armed: true, firearmActive: true, orgType: "event_company" }, "ppo"],
    ["unknown distance", { distanceMiles: null }, "location"],
    ["outside the work radius", { distanceMiles: 40, radiusMiles: 25 }, "radius"],
    ["no availability", { availability: "unavailable" as const }, "availability"],
    ["hourly pay under the worker minimum", { payMinCents: 1500, workerMinHourlyCents: 2000 }, "pay"],
  ])("rejects %s", (_label, patch, reason) => {
    expect(eligibilityFailure({ ...base, ...patch })).toBe(reason);
  });

  it("allows an unarmed shift from a verified organization that is not a PPO", () => {
    expect(eligibilityFailure({ ...base, orgType: "school" })).toBeNull();
  });

  it("allows a flat rate when an hourly minimum is on file", () => {
    expect(eligibilityFailure({ ...base, payType: "flat", payMinCents: 100, workerMinHourlyCents: 5000 })).toBeNull();
  });
});

describe("deterministic score", () => {
  it("ranks a closer category match ahead of a distant one and breaks ties by id", () => {
    const near = deterministicScore({
      categoryMatch: true,
      distanceMiles: 2,
      radiusMiles: 25,
      payMeetsMinimum: true,
      yearsExperience: 5,
      minYears: 1,
      urgency: "normal",
      vehicleRequired: false,
      hasTransportation: null,
    });
    const far = deterministicScore({
      categoryMatch: false,
      distanceMiles: 24,
      radiusMiles: 25,
      payMeetsMinimum: true,
      yearsExperience: 5,
      minYears: 1,
      urgency: "normal",
      vehicleRequired: false,
      hasTransportation: null,
    });
    expect(near).toBeGreaterThan(far);
    const ordered = [
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", score: 10, distanceMiles: 3 },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", score: 10, distanceMiles: 3 },
    ].sort(compareDeterministic);
    expect(ordered.map((row) => row.id)[0]).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});

describe("Grok output validation", () => {
  const eligibleId = "33333333-3333-4333-8333-333333333333";
  const supported = supportedReasonCodes(fact());

  it("sends only the allowlisted fields and drops forbidden keys", () => {
    const candidate = toGrokCandidate(fact(), "workers_for_job");
    expect(promptFieldNamesMatch(candidate)).toBe(true);
    expect(Object.keys(candidate).sort()).toEqual([...GROK_PROMPT_FIELDS].sort());
    expect(forbiddenPromptKey(candidate)).toBeNull();
    expect(JSON.stringify(candidate)).not.toContain("Should Not Be Sent");
    expect(JSON.stringify(candidate)).not.toContain("credential_number");
    expect(JSON.stringify(buildGrokRequestBody("grok-4", [candidate]))).not.toContain("BSIS");
    const poisoned = { ...candidate, conviction: "none", languages: ["Spanish"] };
    expect(forbiddenPromptKey(poisoned)).toBe("conviction");
  });

  it("drops unknown ids and unsupported reason codes", () => {
    const result = validateGrokRankings(
      {
        rankings: [
          { id: eligibleId.toUpperCase(), reason_codes: ["WITHIN_RADIUS", "FIREARM_PERMIT_ACTIVE"] },
          { id: "44444444-4444-4444-8444-444444444444", reason_codes: ["GUARD_CARD_ACTIVE"] },
        ],
        summary: "Invented credential BSIS-999111 and a conviction.",
      },
      [{ id: eligibleId, supportedCodes: supported }],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rankings).toEqual([{ id: eligibleId, reasonCodes: ["WITHIN_RADIUS"] }]);
    expect(JSON.stringify(result)).not.toContain("BSIS-999111");
    expect(JSON.stringify(result)).not.toContain("summary");
  });

  it("rejects a payload that is not the schema or that names nobody eligible", () => {
    expect(validateGrokRankings({ rankings: [{ id: "not-a-uuid", reason_codes: [] }] }, [{ id: eligibleId, supportedCodes: supported }]).ok).toBe(false);
    expect(validateGrokRankings({ rankings: [] }, [{ id: eligibleId, supportedCodes: supported }]).ok).toBe(false);
    expect(parseGrokContent("```json\n{\"rankings\":[]}\n```")).toEqual({ rankings: [] });
    expect(parseGrokContent("not json")).toBeNull();
  });

  it("keeps eligible ids the model omitted, after the model's order", () => {
    expect(mergeRankOrder([eligibleId], [eligibleId, "55555555-5555-4555-8555-555555555555"])).toEqual([
      eligibleId,
      "55555555-5555-4555-8555-555555555555",
    ]);
  });
});
