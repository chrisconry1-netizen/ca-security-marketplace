import { describe, expect, it } from "vitest";
import { employerErrorCode } from "@/lib/employer/messages";
import { placeLooksPublic, recurrenceRule } from "@/lib/jobs/constants";
import { transitionJob } from "@/lib/jobs/state";
import { isoToPacificParts, pacificWallTimeToIso } from "@/lib/jobs/time";
import { jobReadyToPublish, type JobWrite } from "@/lib/jobs/validation";
import { parseCounties } from "@/lib/orgs/constants";

const readyJob: JobWrite = {
  title: "Lobby post",
  description: "Watch the lobby entrance overnight.",
  job_type: "contract",
  category: "unarmed_security",
  is_armed: false,
  urgency: "normal",
  city: "Oakland",
  county: "Alameda",
  postal_code: null,
  starts_at: null,
  ends_at: null,
  recurrence_rule: null,
  pay_type: "hourly",
  pay_min_cents: 3200,
  pay_max_cents: null,
  workers_needed: 1,
  min_years_experience: null,
  uniform_notes: null,
  vehicle_required: false,
  requires_off_duty_le: false,
  equipment_notes: null,
  application_deadline: null,
  site_address: null,
  credential_type_ids: [],
  intent: "publish",
};

describe("Pacific wall time", () => {
  it("converts standard and daylight times and rejects a spring-forward gap", () => {
    expect(pacificWallTimeToIso("2026-01-15", "09:00")).toBe("2026-01-15T17:00:00.000Z");
    expect(pacificWallTimeToIso("2026-07-15", "09:00")).toBe("2026-07-15T16:00:00.000Z");
    expect(isoToPacificParts("2026-01-15T17:00:00.000Z")).toEqual({ date: "2026-01-15", time: "09:00" });
    expect(isoToPacificParts("2026-07-15T16:00:00.000Z")).toEqual({ date: "2026-07-15", time: "09:00" });
    expect(pacificWallTimeToIso("2026-03-08", "02:30")).toBeNull();
  });
});

describe("job transitions", () => {
  it("holds an unverified publish in pending review", () => {
    expect(transitionJob("draft", "published", false)).toBe("pending_review");
    expect(transitionJob("pending_review", "published", false)).toBe("pending_review");
    expect(transitionJob("draft", "published", true)).toBe("published");
    expect(transitionJob("pending_review", "published", true)).toBe("published");
    expect(transitionJob("completed", "published", true)).toBeNull();
    expect(transitionJob("published", "completed", true)).toBeNull();
  });
});

describe("publish readiness", () => {
  it("matches the server completeness gate closely enough to avoid a wasted call", () => {
    expect(jobReadyToPublish(readyJob)).toBe(true);
    expect(jobReadyToPublish({ ...readyJob, description: "Too short" })).toBe(false);
    expect(jobReadyToPublish({ ...readyJob, city: "100 Market Street" })).toBe(false);
    expect(jobReadyToPublish({ ...readyJob, job_type: "single_shift" })).toBe(false);
    expect(placeLooksPublic("Oakland")).toBe(true);
    expect(placeLooksPublic("100 Market Street")).toBe(false);
  });
});

describe("employer errors and counties", () => {
  it("maps database phrases to the fixed catalogue", () => {
    expect(employerErrorCode("last owner")).toBe("last_owner");
    expect(employerErrorCode("license number required")).toBe("license_required");
    expect(employerErrorCode("contact email required")).toBe("email_required");
    expect(employerErrorCode("invite email mismatch")).toBe("invite_email");
    expect(employerErrorCode("job is incomplete")).toBe("job_incomplete");
    expect(employerErrorCode("illegal job transition")).toBe("job_transition");
    expect(employerErrorCode("something else")).toBe("invalid_input");
  });

  it("parses county lists and weekly days", () => {
    expect(parseCounties("Alameda, Contra Costa")).toEqual(["Alameda", "Contra Costa"]);
    expect(parseCounties(["x".repeat(81)].join("\n"))).toBeNull();
    expect(parseCounties("Alameda\u0000")).toBeNull();
    expect(recurrenceRule(["FR", "MO"])).toBe("FREQ=WEEKLY;BYDAY=MO,FR");
    expect(recurrenceRule(["MO", "NOPE"])).toBeNull();
    expect(recurrenceRule([])).toBeNull();
  });
});
