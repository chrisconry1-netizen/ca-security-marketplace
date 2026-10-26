import { describe, expect, it } from "vitest";
import { applyBlockReason } from "@/lib/jobs/eligibility";
import { marketplaceErrorCode } from "@/lib/jobs/messages";
import { formatDistance, formatJobPay } from "@/lib/jobs/present";
import { parseJobSearch, toSearchRpc } from "@/lib/jobs/search-params";
import { canEmployerTransition, canWorkerTransition } from "@/lib/jobs/state";
import { jobDraftSchema } from "@/lib/jobs/validation";

const draft = {
  title: "Lobby overnight",
  description: "Front desk and patrol of the public lobby.",
  jobType: "single_shift",
  category: "unarmed_security",
  armed: "no",
  urgency: "normal",
  city: "Oakland",
  county: "Alameda",
  postalCode: "94612",
  siteAddress: "400 Broadway",
  siteLat: "",
  siteLng: "",
  approxLat: "",
  approxLng: "",
  startsLocal: "2026-11-15T09:00",
  endsLocal: "2026-11-15T17:00",
  payType: "hourly",
  payMin: "28.00",
  payMax: "",
  workersNeeded: "1",
  minYears: "",
  uniformNotes: "",
  vehicleRequired: false,
  equipmentNotes: "",
  deadlineLocal: "",
  requiredCodes: ["ca_guard_registration"],
  optionalCodes: [],
};

describe("application state machine", () => {
  it("lets a worker withdraw, accept, or decline and nothing else", () => {
    expect(canWorkerTransition("submitted", "withdrawn")).toBe(true);
    expect(canWorkerTransition("offered", "accepted")).toBe(true);
    expect(canWorkerTransition("offered", "declined")).toBe(true);
    expect(canWorkerTransition("submitted", "shortlisted")).toBe(false);
    expect(canWorkerTransition("submitted", "accepted")).toBe(false);
    expect(canWorkerTransition("accepted", "withdrawn")).toBe(false);
    expect(canWorkerTransition("rejected", "withdrawn")).toBe(false);
    expect(canWorkerTransition("withdrawn", "submitted")).toBe(false);
  });

  it("lets an employer move review states and reject an offer", () => {
    expect(canEmployerTransition("submitted", "shortlisted")).toBe(true);
    expect(canEmployerTransition("shortlisted", "offered")).toBe(true);
    expect(canEmployerTransition("offered", "rejected")).toBe(true);
    expect(canEmployerTransition("submitted", "submitted")).toBe(false);
    expect(canEmployerTransition("submitted", "accepted")).toBe(false);
    expect(canEmployerTransition("submitted", "withdrawn")).toBe(false);
    expect(canEmployerTransition("offered", "shortlisted")).toBe(false);
    expect(canEmployerTransition("accepted", "rejected")).toBe(false);
    expect(canEmployerTransition("rejected", "reviewing")).toBe(false);
  });
});

describe("eligibility", () => {
  const shiftDate = "2026-11-15";
  it("blocks armed work without both verified permits", () => {
    expect(
      applyBlockReason({
        armed: true,
        mandatoryCodes: [],
        shiftDate,
        credentials: [{ code: "ca_guard_registration", status: "verified", expiresOn: "2027-01-01" }],
      }),
    ).toBe("armed_blocked");
  });

  it("blocks a mandatory credential that is missing, pending, or expired on the shift date", () => {
    expect(
      applyBlockReason({
        armed: false,
        mandatoryCodes: ["ca_guard_registration"],
        shiftDate,
        credentials: [{ code: "ca_guard_registration", status: "pending", expiresOn: "2027-01-01" }],
      }),
    ).toBe("credential_blocked");
    expect(
      applyBlockReason({
        armed: false,
        mandatoryCodes: ["ca_guard_registration"],
        shiftDate,
        credentials: [{ code: "ca_guard_registration", status: "verified", expiresOn: "2026-11-14" }],
      }),
    ).toBe("credential_blocked");
  });

  it("allows a credential that expires on the shift date and ignores optional gaps", () => {
    expect(
      applyBlockReason({
        armed: true,
        mandatoryCodes: ["cpr_aed"],
        shiftDate,
        credentials: [
          { code: "ca_guard_registration", status: "verified", expiresOn: "2026-11-15" },
          { code: "ca_exposed_firearm_permit", status: "verified", expiresOn: null },
          { code: "cpr_aed", status: "verified", expiresOn: "2028-01-01" },
        ],
      }),
    ).toBeNull();
  });
});

describe("search and pay presentation", () => {
  it("formats employer-entered pay and approximate distance", () => {
    expect(formatJobPay("hourly", 2800, 3200)).toBe("$28.00–$32.00 / hour");
    expect(formatJobPay("flat", 15000, null)).toBe("$150.00 flat");
    expect(formatDistance(0.4)).toBe("Under 1 mi");
    expect(formatDistance(12.2)).toBe("About 12 mi");
  });

  it("sends radius only when a server-resolved origin exists", () => {
    const input = parseJobSearch({ city: "Oakland", near: "94612", radius: "25", eligible: "1", pay: "28.00", page: "2" });
    expect(input.eligible).toBe(true);
    expect(input.page).toBe(2);
    const withOrigin = toSearchRpc(input, { lat: 37.8, lng: -122.27 });
    expect(withOrigin.args.p_radius_miles).toBe(25);
    expect(withOrigin.args.p_pay_min_cents).toBe(2800);
    expect(withOrigin.args.p_eligible_only).toBe(true);
    expect(withOrigin.ignoredRadius).toBe(false);
    const dropped = toSearchRpc(input, null);
    expect(dropped.args.p_lat).toBeNull();
    expect(dropped.args.p_radius_miles).toBeNull();
    expect(dropped.ignoredRadius).toBe(true);
  });

  it("rejects a street address in the public city", () => {
    expect(jobDraftSchema.safeParse({ ...draft, city: "400 Broadway" }).success).toBe(false);
    expect(jobDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("maps database errors onto the fixed message catalogue", () => {
    expect(marketplaceErrorCode("armed credential missing")).toBe("armed_blocked");
    expect(marketplaceErrorCode("mandatory credential missing")).toBe("credential_blocked");
    expect(marketplaceErrorCode("already applied")).toBe("already_applied");
    expect(marketplaceErrorCode("illegal application transition")).toBe("illegal_transition");
    expect(marketplaceErrorCode("job is filled")).toBe("job_filled");
    expect(marketplaceErrorCode("public location cannot be a street address")).toBe("address_not_allowed");
  });
});
