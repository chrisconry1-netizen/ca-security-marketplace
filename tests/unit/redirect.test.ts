import { describe, expect, it } from "vitest";
import { isProtectedPath, safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("accepts same-origin relative paths", () => {
    expect(safeNextPath("/worker")).toBe("/worker");
    expect(safeNextPath("/admin?tab=a#x")).toBe("/admin?tab=a#x");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "\\\\evil", "javascript:alert(1)", "", "worker", "/\u0000x", "/a\\b", 42, null, undefined, "/" + "a".repeat(600)])(
    "rejects %j",
    (v) => expect(safeNextPath(v)).toBe("/dashboard"),
  );
  it("normalizes dot segments without escaping origin", () => {
    expect(safeNextPath("/../../etc")).toBe("/etc");
  });
});

describe("isProtectedPath", () => {
  it("matches protected prefixes only on segment boundary", () => {
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/admin/users")).toBe(true);
    expect(isProtectedPath("/administrator")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
  });
});
