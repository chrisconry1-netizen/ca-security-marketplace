import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/ui";
import { PUBLIC_JOB_COLUMNS } from "@/lib/jobs/constants";
import { JOB_MESSAGES } from "@/lib/jobs/messages";
import { categoryLabel, formatJobPay, formatShiftWhen, jobTypeLabel } from "@/lib/jobs/present";
import { employerNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function EmployerJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const ids = ctx.orgMemberships.map((membership) => membership.organization_id);
  const supabase = await createClient();
  const { data } = ids.length
    ? await supabase.from("jobs").select(PUBLIC_JOB_COLUMNS).in("organization_id", ids).order("created_at", { ascending: false })
    : { data: [] };
  const jobs = data ?? [];

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={sp.notice} tone="info" messages={JOB_MESSAGES} />
      <Notice code={sp.error} messages={JOB_MESSAGES} />
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Jobs and shifts</h1>
        <Link href="/employer/jobs/new" className="shrink-0 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
          Post a shift
        </Link>
      </div>
      {!ids.length && (
        <p className="mt-4 text-sm text-slate-600">
          <Link href="/employer/org" className="font-semibold underline">
            Create an organization
          </Link>{" "}
          before posting a shift.
        </p>
      )}
      <div className="mt-4 space-y-3">
        {jobs.map((job) => (
          <article key={job.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold text-slate-900">
              <Link href={`/employer/jobs/${job.id}`} className="underline-offset-2 hover:underline">
                {job.title}
              </Link>
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {job.status} · {[job.city, job.county].filter(Boolean).join(" · ") || "Location not set"}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{formatJobPay(job.pay_type, job.pay_min_cents, job.pay_max_cents)}</p>
            <p className="mt-1 text-sm text-slate-700">{formatShiftWhen(job.starts_at, job.ends_at, job.shift_period)}</p>
            <p className="mt-1 text-sm text-slate-600">
              {categoryLabel(job.category)} · {job.is_armed ? "Armed" : "Unarmed"} · {jobTypeLabel(job.job_type)}
            </p>
          </article>
        ))}
        {ids.length > 0 && jobs.length === 0 && <p className="text-sm text-slate-600">No shifts yet.</p>}
      </div>
    </AppShell>
  );
}
