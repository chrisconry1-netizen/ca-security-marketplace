import "server-only";
import { MATCH_RANK_LIMIT, DETERMINISTIC_MODEL, DETERMINISTIC_VERSION } from "@/lib/matching/constants";
import {
  forbiddenPromptKey,
  parseMatchFact,
  scoreFact,
  supportedReasonCodes,
  toGrokCandidate,
  type MatchFact,
} from "@/lib/matching/facts";
import { mergeRankOrder, validateGrokRankings } from "@/lib/matching/grok-output";
import { compareDeterministic } from "@/lib/matching/score";
import { createClient } from "@/lib/supabase/server";
import { requestMeta } from "@/server/audit/audit";
import { createAdminClient } from "@/server/privileged/admin-client";
import { rankWithGrok } from "@/server/matching/grok";

type Direction = "jobs_for_worker" | "workers_for_job";

export type MatchRunResult = { ok: true; runId: string } | { ok: false; error: "match_rate_limit" | "not_allowed" | "match_failed" };

function errorCode(message: string | undefined): MatchRunResult {
  const text = message ?? "";
  if (/match rate limit/i.test(text)) return { ok: false, error: "match_rate_limit" };
  if (/not a member|not a worker|not permitted|account not active/i.test(text)) return { ok: false, error: "not_allowed" };
  return { ok: false, error: "match_failed" };
}

export async function runMatch(input: { actorId: string; direction: Direction; jobId?: string | null }): Promise<MatchRunResult> {
  const supabase = await createClient();
  const loaded =
    input.direction === "jobs_for_worker"
      ? await supabase.rpc("eligible_shifts_for_me")
      : await supabase.rpc("eligible_workers_for_job", { p_job_id: input.jobId ?? null });
  if (loaded.error) return errorCode(loaded.error.message);

  const facts: MatchFact[] = [];
  for (const row of (loaded.data ?? []) as { fact?: unknown }[]) {
    const fact = parseMatchFact(row.fact);
    if (!fact) continue;
    const candidate = toGrokCandidate(fact, input.direction);
    if (forbiddenPromptKey(candidate)) continue;
    facts.push(fact);
  }

  const rankedFacts = [...facts].sort((a, b) =>
    compareDeterministic(
      {
        id: input.direction === "jobs_for_worker" ? a.jobId : a.workerId,
        score: scoreFact(a),
        distanceMiles: a.distanceMiles,
      },
      {
        id: input.direction === "jobs_for_worker" ? b.jobId : b.workerId,
        score: scoreFact(b),
        distanceMiles: b.distanceMiles,
      },
    ),
  );
  const capped = rankedFacts.slice(0, MATCH_RANK_LIMIT);
  const fallbackIds = capped.map((fact) => (input.direction === "jobs_for_worker" ? fact.jobId : fact.workerId));

  let source: "grok" | "deterministic_fallback" = "deterministic_fallback";
  let fallback: "missing_api_key" | "provider_error" | "invalid_output" | "empty_eligible_set" =
    capped.length === 0 ? "empty_eligible_set" : "missing_api_key";
  let model = DETERMINISTIC_MODEL;
  let modelVersion = DETERMINISTIC_VERSION;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let ordered = fallbackIds;
  const reasons: Record<string, string[]> = {};
  for (const fact of capped) {
    const id = input.direction === "jobs_for_worker" ? fact.jobId : fact.workerId;
    reasons[id] = supportedReasonCodes(fact);
  }

  if (capped.length > 0) {
    const grok = await rankWithGrok(capped.map((fact) => toGrokCandidate(fact, input.direction)));
    if (grok.ok) {
      const validated = validateGrokRankings(
        grok.raw,
        capped.map((fact) => ({
          id: input.direction === "jobs_for_worker" ? fact.jobId : fact.workerId,
          supportedCodes: supportedReasonCodes(fact),
        })),
      );
      if (validated.ok && validated.rankings.length > 0) {
        source = "grok";
        model = grok.model;
        modelVersion = grok.model;
        inputTokens = grok.inputTokens;
        outputTokens = grok.outputTokens;
        ordered = mergeRankOrder(
          validated.rankings.map((row) => row.id),
          fallbackIds,
        );
        for (const row of validated.rankings) reasons[row.id] = row.reasonCodes;
      } else {
        fallback = "invalid_output";
      }
    } else if (capped.length > 0) {
      fallback = grok.reason;
    }
  }

  const meta = await requestMeta();
  const recorded = await createAdminClient().rpc("record_match_run", {
    p_actor: input.actorId,
    p_direction: input.direction,
    p_job_id: input.direction === "workers_for_job" ? input.jobId : null,
    p_ordered_ids: ordered,
    p_reason_codes: reasons,
    p_model: source === "grok" ? model : DETERMINISTIC_MODEL,
    p_model_version: source === "grok" ? modelVersion : DETERMINISTIC_VERSION,
    p_source: source,
    p_fallback_reason: source === "grok" ? null : fallback,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (recorded.error || typeof recorded.data !== "string") return errorCode(recorded.error?.message);
  return { ok: true, runId: recorded.data };
}
