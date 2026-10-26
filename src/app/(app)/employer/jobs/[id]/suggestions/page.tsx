import Link from "next/link";
import { notFound } from "next/navigation";
import { refreshJobMatches } from "@/app/(app)/matching/actions";
import { openConversation } from "@/app/(app)/messages/actions";
import { AppShell } from "@/components/app-shell";
import { EligibilityChecklist, MatchSourceBanner, suggestionChecklist } from "@/components/matching/match-list";
import { Notice } from "@/components/ui";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { MATCHING_MESSAGES } from "@/lib/matching/messages";
import { MESSAGING_MESSAGES } from "@/lib/messaging/messages";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function SuggestedWorkersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireArea("employer");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id, title, organization_id, status").eq("id", id).maybeSingle();
  if (!job || !ctx.orgMemberships.some((membership) => membership.organization_id === job.organization_id)) notFound();
  const { data: runs } = await supabase
    .from("match_runs")
    .select("id, model, model_version, source, fallback_reason, eligible_count, ranked_count")
    .eq("direction", "workers_for_job")
    .eq("job_id", id)
    .order("created_at", { ascending: false })
    .limit(1);
  const run = runs?.[0] ?? null;
  const { data: suggestions } = run
    ? await supabase
        .from("match_suggestions")
        .select("id, rank, worker_id, explanation, checklist, subject_label, meta_line")
        .eq("run_id", run.id)
        .order("rank")
    : { data: [] };
  const workerIds = (suggestions ?? []).map((row) => row.worker_id);
  const { data: cards } = workerIds.length
    ? await supabase
        .from("worker_search_cards")
        .select("user_id, display_name, headline, city, county, years_experience, work_radius_miles")
        .in("user_id", workerIds)
    : { data: [] };
  const cardsById = new Map((cards ?? []).map((card) => [card.user_id, card]));
  const visible = (suggestions ?? []).filter((row) => cardsById.has(row.worker_id));

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={{ ...MATCHING_MESSAGES, ...MESSAGING_MESSAGES }} />
      <Notice code={queryValue(sp.error)} messages={{ ...MATCHING_MESSAGES, ...MESSAGING_MESSAGES }} />
      <p className="mt-2 text-sm text-slate-600">
        <Link href={`/employer/jobs/${job.id}`} className="font-medium text-slate-900 underline">
          Back to {job.title}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Suggested workers</h1>
      <p className="mt-1 text-sm text-slate-600">
        Only workers who opted into search are listed, and only when they already pass the eligibility checks. This does not send an offer, reject anyone, or contact them.
      </p>
      {job.status === "published" ? (
        <form action={refreshJobMatches} className="mt-4">
          <input type="hidden" name="jobId" value={job.id} />
          <button type="submit" className="min-h-11 w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white sm:w-auto">
            Refresh suggestions
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-slate-600">Publish the shift before asking for suggestions.</p>
      )}
      {run && <MatchSourceBanner source={run.source} fallbackReason={run.fallback_reason} />}
      {run && (
        <p className="mt-2 text-xs text-slate-500">
          Model {run.model} · version {run.model_version}
        </p>
      )}
      {!run && job.status === "published" && <p className="mt-4 text-sm text-slate-600">Refresh to see workers who already pass the eligibility checks.</p>}
      {run && visible.length === 0 && (
        <p className="mt-4 text-sm text-slate-600">No opted-in worker passed the checks for this shift.</p>
      )}
      <div className="mt-4 space-y-3">
        {visible.map((row) => {
          const card = cardsById.get(row.worker_id);
          if (!card) return null;
          return (
            <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-slate-900">{card.display_name}</h2>
              {card.headline && <p className="mt-1 text-sm text-slate-700">{card.headline}</p>}
              <p className="mt-1 text-sm text-slate-600">
                {[card.city, card.county].filter(Boolean).join(" · ") || "Area not listed"}
                {card.years_experience != null ? ` · ${card.years_experience} years` : ""}
              </p>
              <p className="mt-2 text-sm text-slate-800">{row.explanation}</p>
              <EligibilityChecklist items={suggestionChecklist(row.checklist)} />
              <form action={openConversation} className="mt-3">
                <input type="hidden" name="workerId" value={card.user_id} />
                <input type="hidden" name="organizationId" value={job.organization_id} />
                <input type="hidden" name="returnTo" value={`/employer/jobs/${job.id}/suggestions`} />
                <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900">
                  Message
                </button>
              </form>
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
