import { describe, expect, it } from "vitest";
import { accountTypeSchema, authMessage, passwordSchema, registerSchema } from "@/lib/auth/validation";

describe("passwordSchema", () => {
  it.each(["short1A", "alllowercase123", "ALLUPPERCASE123", "NoDigitsHereAtAll"])("rejects %s", (pw) => {
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });
  it("accepts a strong password", () => expect(passwordSchema.safeParse("Correct-Horse9Battery").success).toBe(true));
});

describe("registerSchema", () => {
  const base = { displayName: "Jane Guard", email: " Jane@Example.COM ", password: "Correct-Horse9Battery", confirmPassword: "Correct-Horse9Battery", acceptTerms: "on" };
  it("normalizes email", () => {
    const r = registerSchema.safeParse(base);
    expect(r.success && r.data.email).toBe("jane@example.com");
  });
  it("requires matching passwords and terms", () => {
    expect(registerSchema.safeParse({ ...base, confirmPassword: "x" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, acceptTerms: undefined }).success).toBe(false);
  });
});

describe("accountTypeSchema", () => {
  it("only allows worker/employer (never staff or admin)", () => {
    expect(accountTypeSchema.safeParse("worker").success).toBe(true);
    expect(accountTypeSchema.safeParse("employer").success).toBe(true);
    for (const v of ["staff", "admin", "super_admin", ""]) expect(accountTypeSchema.safeParse(v).success).toBe(false);
  });
});

describe("authMessage", () => {
  it("returns only catalogued messages (no reflected input)", () => {
    expect(authMessage("invalid_credentials")).toMatch(/incorrect/);
    expect(authMessage("<script>")).toBeNull();
    expect(authMessage("toString")).toBeNull();
    expect(authMessage(["invalid_credentials"])).toBeNull();
  });
});
