import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pill, verificationTone } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { compensationLine, JOB_COLUMNS } from "@/lib/jobs/validation";
import { jobStatusLabel } from "@/lib/jobs/state";
import { jobTypeLabel } from "@/lib/jobs/constants";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const requested = queryValue(sp.org);
  const orgId = ctx.orgMemberships.some((membership) => membership.organization_id === requested) ? requested : "";
  const ids = orgId ? [orgId] : ctx.orgMemberships.map((membership) => membership.organization_id);
  const supabase = await createClient();
  const { data: jobs } = ids.length
    ? await supabase.from("jobs").select(JOB_COLUMNS).in("organization_id", ids).order("created_at", { ascending: false })
    : { data: [] };
  const createHref = orgId || ctx.orgMemberships[0]?.organization_id;

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={EMPLOYER_MESSAGES} />
      <Notice code={queryValue(sp.error)} messages={EMPLOYER_MESSAGES} />
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Jobs &amp; shifts</h1>
        {createHref && (
          <Link href={`/employer/jobs/new?org=${createHref}`} className="shrink-0 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">New job</Link>
        )}
      </div>
      <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {(jobs ?? []).length === 0 && <li className="p-4 text-sm text-slate-600">No jobs yet.</li>}
        {(jobs ?? []).map((job) => (
          <li key={job.id}>
            <Link href={`/employer/jobs/${job.id}`} className="flex items-center justify-between gap-3 p-4">
              <span>
                <span className="block font-medium text-slate-900">{job.title}</span>
                <span className="block text-sm text-slate-600">{jobTypeLabel(job.job_type)} · {job.city || "Area not set"} · {compensationLine(job.pay_type, job.pay_min_cents, job.pay_max_cents)}</span>
              </span>
              <Pill label={jobStatusLabel(job.status)} tone={verificationTone(job.status)} />
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
