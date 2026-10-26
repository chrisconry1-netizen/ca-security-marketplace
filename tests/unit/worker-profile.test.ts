import { describe, expect, it } from "vitest";
import { SECURITY_CATEGORIES, CREDENTIAL_TYPE_CODES } from "@/lib/workers/categories";
import { credentialTimeState, pacificToday } from "@/lib/workers/expiry";
import { detectAvatar, detectDocument, sniffAvatar, sniffDocument } from "@/lib/storage/files";
import { zonedTimeToUtc } from "@/lib/workers/time";
import { dollarsToCents, looksLikeStreetAddress, maskCredentialNumber, parseSkills, profileSchema } from "@/lib/workers/validation";

describe("security categories", () => {
  it("matches the Phase 2 assignment list", () => {
    expect(SECURITY_CATEGORIES.map((c) => c.label)).toEqual([
      "Unarmed",
      "Armed",
      "Executive Protection",
      "Event",
      "Corporate",
      "Residential",
      "Hospital",
      "School",
      "Retail",
      "Loss Prevention",
      "Patrol",
      "Mobile Patrol",
      "Close Protection",
      "Plainclothes",
      "Supervisor",
      "Security Manager",
    ]);
    expect(new Set(SECURITY_CATEGORIES.map((c) => c.code)).size).toBe(16);
  });
  it("seeds the credential type codes", () => {
    expect(CREDENTIAL_TYPE_CODES).toEqual([
      "ca_guard_registration",
      "ca_exposed_firearm_permit",
      "ca_baton_permit",
      "cpr_aed",
      "first_aid",
      "taser",
      "oc",
      "ep_training",
      "drivers_license",
      "other",
    ]);
  });
});

describe("profile validation", () => {
  const base = {
    displayName: "A Guard",
    headline: "Unarmed and event",
    bio: "Nights and weekends.",
    city: "Los Angeles",
    county: "Los Angeles",
    postalCode: "90012",
    workRadiusMiles: "25",
    yearsExperience: "4",
    securityExperience: "Site posts and events.",
    hasLeExperience: false,
    leExperienceSummary: "",
    categories: ["unarmed_security", "event_security"],
    minHourlyRate: "28.50",
    transportation: "yes",
    languages: ["English", "Spanish"],
    additionalLanguage: "",
    skills: "Report writing, radio",
    searchable: false,
  };

  it("accepts a general location and pay in cents", () => {
    const parsed = profileSchema.parse(base);
    expect(parsed.city).toBe("Los Angeles");
    expect(dollarsToCents(parsed.minHourlyRate)).toBe(2850);
    expect(dollarsToCents("25")).toBe(2500);
  });

  it("rejects street addresses in city or county", () => {
    expect(looksLikeStreetAddress("123 Main Street")).toBe(true);
    expect(looksLikeStreetAddress("Los Angeles")).toBe(false);
    expect(profileSchema.safeParse({ ...base, city: "123 Main Street" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...base, county: "Sunset Boulevard" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...base, postalCode: "90012-1234" }).success).toBe(true);
    expect(profileSchema.safeParse({ ...base, postalCode: "Los Angeles" }).success).toBe(false);
  });

  it("rejects an out-of-range radius and unknown skills characters", () => {
    expect(profileSchema.safeParse({ ...base, workRadiusMiles: "0" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...base, workRadiusMiles: "" }).success).toBe(true);
    expect(parseSkills("Report writing, <script>")).toBeNull();
    expect(parseSkills("Report writing, radio")).toEqual(["Report writing", "radio"]);
  });

  it("masks credential numbers", () => {
    expect(maskCredentialNumber("G1234567")).toBe("•••• 4567");
    expect(maskCredentialNumber("123")).toBe("••••");
    expect(maskCredentialNumber(null)).toBe("—");
  });
});

describe("credential time state", () => {
  const today = pacificToday(new Date("2026-06-15T20:00:00Z"));

  it("uses the Pacific calendar date", () => {
    expect(today).toBe("2026-06-15");
    expect(pacificToday(new Date("2026-06-16T06:30:00Z"))).toBe("2026-06-15");
  });

  it("classifies expired, expiring soon, and valid the same way as SQL", () => {
    expect(credentialTimeState("verified", "2026-06-14", today)).toBe("expired");
    expect(credentialTimeState("pending", "2026-06-14", today)).toBe("expired");
    expect(credentialTimeState("verified", "2026-06-15", today)).toBe("expiring_soon");
    expect(credentialTimeState("verified", "2026-07-15", today)).toBe("expiring_soon");
    expect(credentialTimeState("verified", "2026-07-16", today)).toBe("valid");
    expect(credentialTimeState("pending", "2026-06-20", today)).toBe("valid");
    expect(credentialTimeState("rejected", "2026-06-01", today)).toBe("valid");
    expect(credentialTimeState("verified", null, today)).toBe("none");
    expect(credentialTimeState("expired", "2026-12-01", today)).toBe("expired");
  });
});

describe("Pacific timestamps", () => {
  it("converts winter and summer wall times", () => {
    expect(zonedTimeToUtc("2026-01-15", "09:00").toISOString()).toBe("2026-01-15T17:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-15", "09:00").toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });
});

describe("file sniffing", () => {
  it("accepts png, jpeg, webp, and pdf magic bytes and rejects html", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(detectAvatar(png)?.mime).toBe("image/png");
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    expect(detectDocument(jpg)?.ext).toBe("jpg");
    const pdf = Uint8Array.from(Buffer.from("%PDF-1.4"));
    expect(detectDocument(pdf)?.mime).toBe("application/pdf");
    const webp = new Uint8Array(12);
    webp.set(Buffer.from("RIFF"), 0);
    webp.set(Buffer.from("WEBP"), 8);
    expect(detectAvatar(webp)?.ext).toBe("webp");
    expect(sniffDocument(Uint8Array.from(Buffer.from("<html>")))).toBeNull();
    expect(sniffAvatar(new Uint8Array(2 * 1024 * 1024 + 1))).toBeNull();
  });
});
