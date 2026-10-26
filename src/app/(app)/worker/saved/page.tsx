import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { JobCard } from "@/components/jobs/job-card";
import { Notice } from "@/components/ui";
import { PUBLIC_JOB_COLUMNS } from "@/lib/jobs/constants";
import { JOB_MESSAGES } from "@/lib/jobs/messages";
import { asNumber, embedded } from "@/lib/jobs/present";
import { workerNav } from "@/lib/nav";
import { unsaveJob } from "@/app/jobs/actions";
import type { MarketplaceJob } from "@/server/jobs/search";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function SavedJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("worker");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: saved } = await supabase.from("saved_jobs").select("job_id").order("created_at", { ascending: false });
  const ids = (saved ?? []).map((row) => row.job_id);
  const { data: jobs } = ids.length
    ? await supabase.from("jobs").select(`${PUBLIC_JOB_COLUMNS}, organizations(name, verification_status)`).in("id", ids)
    : { data: [] };
  const cards: MarketplaceJob[] = (jobs ?? []).map((job) => {
    const org = embedded(job.organizations);
    return {
      id: job.id,
      title: job.title,
      summary: job.description.slice(0, 180),
      job_type: job.job_type,
      category: job.category,
      is_armed: job.is_armed,
      urgency: job.urgency,
      city: job.city,
      county: job.county,
      postal_code: job.postal_code,
      shift_period: job.shift_period,
      starts_at: job.starts_at,
      ends_at: job.ends_at,
      pay_type: job.pay_type,
      pay_min_cents: asNumber(job.pay_min_cents),
      pay_max_cents: asNumber(job.pay_max_cents),
      workers_needed: job.workers_needed,
      min_years_experience: job.min_years_experience,
      vehicle_required: job.vehicle_required,
      organization_id: job.organization_id,
      employer_name: org?.name ?? null,
      employer_verified: org?.verification_status === "verified",
      distance_miles: null,
    };
  });

  return (
    <AppShell ctx={ctx} title="Worker" nav={workerNav}>
      <Notice code={sp.notice} tone="info" messages={JOB_MESSAGES} />
      <Notice code={sp.error} messages={JOB_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Saved shifts</h1>
      <div className="mt-4 space-y-3">
        {cards.map((job) => (
          <div key={job.id} className="space-y-2">
            <JobCard job={job} href={`/jobs/${job.id}`} />
            <form action={unsaveJob}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="returnTo" value="/worker/saved" />
              <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900">
                Remove
              </button>
            </form>
          </div>
        ))}
        {cards.length === 0 && (
          <p className="text-sm text-slate-600">
            No saved shifts.{" "}
            <Link href="/worker/shifts" className="font-semibold underline">
              Find shifts
            </Link>
          </p>
        )}
      </div>
    </AppShell>
  );
}
