import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/ui";
import { APPLICATION_LABELS } from "@/lib/jobs/constants";
import { JOB_MESSAGES } from "@/lib/jobs/messages";
import { embedded, formatShiftWhen } from "@/lib/jobs/present";
import { workerNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("worker");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("applications")
    .select("id, status, created_at, jobs(id, title, city, county, starts_at, ends_at, shift_period, status)")
    .order("created_at", { ascending: false });

  return (
    <AppShell ctx={ctx} title="Worker" nav={workerNav}>
      <Notice code={sp.notice} tone="info" messages={JOB_MESSAGES} />
      <Notice code={sp.error} messages={JOB_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Applications</h1>
      <p className="mt-1 text-sm text-slate-600">You can withdraw an open application, or accept or decline an offer. The employer moves the review. A withdrawn application cannot be submitted again for the same shift.</p>
      <div className="mt-4 space-y-3">
        {(data ?? []).map((row) => {
          const job = embedded(row.jobs);
          return (
            <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-bold text-slate-900">
                <Link href={`/worker/applications/${row.id}`} className="underline-offset-2 hover:underline">
                  {job?.title ?? "Shift"}
                </Link>
              </h2>
              <p className="mt-1 text-sm text-slate-600">{job ? [job.city, job.county].filter(Boolean).join(" · ") : ""}</p>
              <p className="mt-1 text-sm text-slate-700">{job ? formatShiftWhen(job.starts_at, job.ends_at, job.shift_period) : ""}</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{APPLICATION_LABELS[row.status] ?? row.status}</p>
            </article>
          );
        })}
        {(data ?? []).length === 0 && <p className="text-sm text-slate-600">No applications yet.</p>}
      </div>
    </AppShell>
  );
}
