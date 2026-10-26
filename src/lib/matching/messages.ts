/** Fixed catalogue. Query-string codes never render database or model text. */
export const MATCHING_MESSAGES: Record<string, string> = {
  matches_refreshed: "Suggestions updated. They are not offers, and nobody was accepted or rejected.",
  match_rate_limit: "Suggestion refresh is limited. Try again later.",
  match_failed: "Suggestions could not be refreshed.",
  not_allowed: "You cannot refresh suggestions for that shift.",
  invalid_input: "Check the form and try again.",
};

export function matchSourceCopy(source: string, fallbackReason: string | null): string {
  if (source === "grok") {
    return "Grok ordered this list from shifts and workers that already passed the eligibility checks. This is a suggestion. It does not accept, reject, or contact anyone.";
  }
  if (fallbackReason === "missing_api_key") {
    return "Grok is not configured. This order uses a fixed score.";
  }
  if (fallbackReason === "empty_eligible_set") {
    return "Nothing passed the eligibility checks, so Grok was not asked to rank this list.";
  }
  return "Grok did not return a usable ranking. This order uses a fixed score.";
}

export interface ChecklistItem {
  code: string;
  label: string;
  passed: boolean;
  applicable: boolean;
}

export function parseChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { code?: unknown; label?: unknown; passed?: unknown; applicable?: unknown };
    if (typeof row.code !== "string" || typeof row.label !== "string") return [];
    return [{ code: row.code, label: row.label, passed: row.passed === true, applicable: row.applicable === true }];
  });
}
