import "server-only";
import { MODEL_ID_PATTERN } from "@/lib/matching/constants";
import type { GrokCandidate } from "@/lib/matching/facts";
import { buildGrokRequestBody, parseGrokContent, sanitizeModelId } from "@/lib/matching/grok-output";

export type GrokRankResult =
  | { ok: true; raw: unknown; model: string; inputTokens: number | null; outputTokens: number | null }
  | { ok: false; reason: "missing_api_key" | "provider_error" | "invalid_output" };

function requestedModel(): string {
  const configured = process.env.XAI_MODEL_MATCHING?.trim();
  if (configured && MODEL_ID_PATTERN.test(configured)) return configured;
  return "grok-4";
}

/**
 * Calls xAI only when XAI_API_KEY is set and matching is not disabled.
 * The key is read here and sent as a header. It is not returned or logged.
 */
export async function rankWithGrok(candidates: readonly GrokCandidate[]): Promise<GrokRankResult> {
  if (process.env.MATCHING_DISABLE_GROK === "1") return { ok: false, reason: "missing_api_key" };
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return { ok: false, reason: "missing_api_key" };
  if (candidates.length === 0) return { ok: false, reason: "missing_api_key" };

  const model = requestedModel();
  const body = buildGrokRequestBody(model, candidates);
  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { ok: false, reason: "provider_error" };
    const payload = (await response.json()) as {
      model?: unknown;
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { ok: false, reason: "invalid_output" };
    const raw = parseGrokContent(content);
    if (raw == null) return { ok: false, reason: "invalid_output" };
    const tokens = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
    return {
      ok: true,
      raw,
      model: sanitizeModelId(typeof payload.model === "string" ? payload.model : null, model),
      inputTokens: tokens(payload.usage?.prompt_tokens),
      outputTokens: tokens(payload.usage?.completion_tokens),
    };
  } catch {
    return { ok: false, reason: "provider_error" };
  }
}
