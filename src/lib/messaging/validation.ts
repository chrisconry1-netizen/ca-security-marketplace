import { ATTACHMENT_MAX_COUNT, MESSAGE_BODY_MAX, SEARCH_QUERY_MAX, SEARCH_QUERY_MIN } from "@/lib/messaging/limits";

export function messageDraftError(
  body: string,
  options: { attachmentCount?: number; jobCard?: boolean } = {},
): string | null {
  const trimmed = body.trim();
  const attachmentCount = options.attachmentCount ?? 0;
  if (attachmentCount > ATTACHMENT_MAX_COUNT) return "attachment_invalid";
  if (options.jobCard && attachmentCount > 0) return "invalid_input";
  if (trimmed.length > MESSAGE_BODY_MAX) return "invalid_input";
  if (!options.jobCard && attachmentCount === 0 && trimmed.length === 0) return "invalid_input";
  return null;
}

export function normalizeSearchQuery(raw: string): { query: string | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { query: null, error: null };
  if (trimmed.length < SEARCH_QUERY_MIN || trimmed.length > SEARCH_QUERY_MAX) return { query: null, error: "invalid_input" };
  return { query: trimmed, error: null };
}

/** Strip LIKE wildcards so a city filter cannot widen the match. */
export function cityContainsPattern(raw: string): string | null {
  const cleaned = raw.trim().replace(/[%_\\,]/g, "").slice(0, 80);
  if (cleaned.length < SEARCH_QUERY_MIN) return null;
  return `%${cleaned}%`;
}
