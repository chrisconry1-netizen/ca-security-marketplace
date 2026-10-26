import Link from "next/link";
import { refreshWorkerMatches } from "@/app/(app)/matching/actions";
import { AppShell } from "@/components/app-shell";
import { EligibilityChecklist, MatchSourceBanner, suggestionChecklist } from "@/components/matching/match-list";
import { Notice } from "@/components/ui";
import { queryValue } from "@/lib/form";
import { PUBLIC_JOB_COLUMNS } from "@/lib/jobs/constants";
import { formatJobPay } from "@/lib/jobs/present";
import { MATCHING_MESSAGES } from "@/lib/matching/messages";
import { workerNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function RecommendedShiftsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("worker");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("match_runs")
    .select("id, model, model_version, source, fallback_reason, eligible_count, ranked_count, created_at")
    .eq("direction", "jobs_for_worker")
    .eq("worker_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const run = runs?.[0] ?? null;
  const { data: suggestions } = run
    ? await supabase
        .from("match_suggestions")
        .select("id, rank, job_id, explanation, checklist, subject_label, meta_line, score")
        .eq("run_id", run.id)
        .order("rank")
    : { data: [] };
  const jobIds = (suggestions ?? []).map((row) => row.job_id);
  const { data: jobs } = jobIds.length
    ? await supabase.from("jobs").select(PUBLIC_JOB_COLUMNS).in("id", jobIds)
    : { data: [] };
  const jobsById = new Map((jobs ?? []).map((job) => [job.id, job]));

  return (
    <AppShell ctx={ctx} title="Worker" nav={workerNav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={MATCHING_MESSAGES} />
      <Notice code={queryValue(sp.error)} messages={MATCHING_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Recommended shifts</h1>
      <p className="mt-1 text-sm text-slate-600">
        Suggestions only. Opening a shift is how you apply. Nothing here accepts an offer or rejects you.
      </p>
      <form action={refreshWorkerMatches} className="mt-4">
        <button type="submit" className="min-h-11 w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white sm:w-auto">
          Refresh suggestions
        </button>
      </form>
      {run && <MatchSourceBanner source={run.source} fallbackReason={run.fallback_reason} />}
      {run && (
        <p className="mt-2 text-xs text-slate-500">
          Model {run.model} · version {run.model_version}
        </p>
      )}
      {!run && <p className="mt-4 text-sm text-slate-600">Refresh to see shifts that already pass the eligibility checks.</p>}
      {run && (suggestions ?? []).length === 0 && (
        <p className="mt-4 text-sm text-slate-600">
          No published shift passed the checks. A suggestion needs a verified unexpired guard card, a work radius that reaches the shift, and availability you saved. Armed, executive-protection, and off-duty posts add their own checks. This is not a decision about whether you may work.
        </p>
      )}
      <div className="mt-4 space-y-3">
        {(suggestions ?? []).map((row) => {
          const job = jobsById.get(row.job_id);
          const title = job?.title ?? row.subject_label;
          return (
            <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {job ? (
                  <Link href={`/jobs/${job.id}`} className="underline">
                    {title}
                  </Link>
                ) : (
                  title
                )}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {job ? formatJobPay(job.pay_type, job.pay_min_cents, job.pay_max_cents) : row.meta_line || "Shift details are no longer listed."}
                {job?.city ? ` · ${job.city}` : ""}
              </p>
              <p className="mt-2 text-sm text-slate-800">{row.explanation}</p>
              <EligibilityChecklist items={suggestionChecklist(row.checklist)} />
              {job && (
                <Link href={`/jobs/${job.id}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-slate-900 underline">
                  Open the shift to apply
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
