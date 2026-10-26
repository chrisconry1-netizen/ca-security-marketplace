import { describe, expect, it } from "vitest";
import { ATTACHMENT_MAX_BYTES, MESSAGE_BODY_MAX, VOICE_CODECS, VOICE_DURATION_MAX_MS } from "@/lib/messaging/limits";
import { messagingErrorCode } from "@/lib/messaging/messages";
import { cityContainsPattern, messageDraftError, normalizeSearchQuery } from "@/lib/messaging/validation";

describe("message drafts", () => {
  it("requires text when there is no attachment or shift card", () => {
    expect(messageDraftError("  ")).toBe("invalid_input");
    expect(messageDraftError("hello")).toBeNull();
  });
  it("rejects oversized bodies and too many files", () => {
    expect(messageDraftError("x".repeat(MESSAGE_BODY_MAX + 1))).toBe("invalid_input");
    expect(messageDraftError("ok", { attachmentCount: 4 })).toBe("attachment_invalid");
    expect(messageDraftError("", { attachmentCount: 1 })).toBeNull();
  });
  it("does not mix a shift card with files", () => {
    expect(messageDraftError("", { jobCard: true })).toBeNull();
    expect(messageDraftError("", { jobCard: true, attachmentCount: 1 })).toBe("invalid_input");
  });
});

describe("inbox search", () => {
  it("treats a blank query as no search", () => {
    expect(normalizeSearchQuery("  ")).toEqual({ query: null, error: null });
  });
  it("rejects one character and very long queries", () => {
    expect(normalizeSearchQuery("a").error).toBe("invalid_input");
    expect(normalizeSearchQuery("a".repeat(81)).error).toBe("invalid_input");
    expect(normalizeSearchQuery("lobby")).toEqual({ query: "lobby", error: null });
  });
  it("strips LIKE wildcards from a city filter", () => {
    expect(cityContainsPattern("%Oak_land\\")).toBe("%Oakland%");
    expect(cityContainsPattern("%")).toBeNull();
  });
});

describe("messaging errors", () => {
  it("maps database exceptions to catalogue codes", () => {
    expect(messagingErrorCode("message rate limit")).toBe("rate_limit");
    expect(messagingErrorCode("blocked")).toBe("blocked");
    expect(messagingErrorCode("job not shareable")).toBe("job_unavailable");
    expect(messagingErrorCode("secret table detail")).toBe("generic");
  });
});

describe("voice reservation", () => {
  it("keeps duration and codec bounds for a later phase", () => {
    expect(VOICE_DURATION_MAX_MS).toBe(300_000);
    expect(VOICE_CODECS).toEqual(["audio/webm", "audio/mp4", "audio/ogg"]);
    expect(ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
