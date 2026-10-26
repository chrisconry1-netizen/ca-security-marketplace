import { describe, expect, it } from "vitest";
import { authorizeArea, deriveRoles, homePathFor, type ProfileFacts } from "@/lib/auth/roles";

const p = (o: Partial<ProfileFacts>): ProfileFacts => ({ account_type: null, platform_role: "user", status: "active", ...o });

describe("deriveRoles", () => {
  it("maps account type, platform role and org roles", () => {
    expect(deriveRoles(p({ account_type: "worker" }))).toEqual(["worker"]);
    expect(deriveRoles(p({ account_type: "employer" }), ["owner_admin", "manager"])).toEqual(["employer", "organization_admin", "organization_manager"]);
    expect(deriveRoles(p({ account_type: "staff", platform_role: "super_admin" }))).toEqual(["super_admin"]);
    expect(deriveRoles(p({}))).toEqual([]);
  });
  it("ignores unknown org roles", () => {
    expect(deriveRoles(p({ account_type: "worker" }), ["bogus" as never])).toEqual(["worker"]);
  });
});

describe("authorizeArea", () => {
  const worker = p({ account_type: "worker" });
  const employer = p({ account_type: "employer" });
  const mod = p({ account_type: "staff", platform_role: "moderator" });
  it("worker area", () => {
    expect(authorizeArea("worker", worker, deriveRoles(worker))).toBe("allow");
    expect(authorizeArea("worker", employer, deriveRoles(employer))).toBe("forbidden");
    expect(authorizeArea("worker", mod, deriveRoles(mod))).toBe("forbidden");
  });
  it("employer area", () => {
    expect(authorizeArea("employer", employer, deriveRoles(employer))).toBe("allow");
    expect(authorizeArea("employer", worker, deriveRoles(worker))).toBe("forbidden");
  });
  it("admin area requires staff role", () => {
    expect(authorizeArea("admin", worker, deriveRoles(worker))).toBe("forbidden");
    expect(authorizeArea("admin", employer, deriveRoles(employer, ["owner_admin"]))).toBe("forbidden");
    expect(authorizeArea("admin", mod, deriveRoles(mod))).toBe("allow");
  });
  it("needs account type before worker/employer areas", () => {
    expect(authorizeArea("worker", p({}), [])).toBe("needs_account_type");
    expect(authorizeArea("admin", p({}), [])).toBe("forbidden");
  });
  it("suspended/deactivated users are blocked everywhere, including staff", () => {
    for (const status of ["suspended", "deactivated"] as const) {
      const s = p({ account_type: "staff", platform_role: "admin", status });
      expect(authorizeArea("admin", s, deriveRoles(s))).toBe("inactive");
      const w = p({ account_type: "worker", status });
      expect(authorizeArea("worker", w, deriveRoles(w))).toBe("inactive");
    }
  });
});

describe("homePathFor", () => {
  it("routes by role", () => {
    expect(homePathFor(p({}), [])).toBe("/account-type");
    expect(homePathFor(p({ account_type: "worker" }), ["worker"])).toBe("/worker");
    expect(homePathFor(p({ account_type: "employer" }), ["employer"])).toBe("/employer");
    expect(homePathFor(p({ account_type: "staff", platform_role: "admin" }), ["admin"])).toBe("/admin");
    expect(homePathFor(p({ account_type: "worker", status: "suspended" }), ["worker"])).toBe("/account-inactive");
  });
});
