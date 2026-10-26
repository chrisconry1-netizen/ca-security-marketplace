import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/ui";
import { acceptOffer, declineOffer, withdrawApplication } from "@/app/jobs/actions";
import { APPLICATION_LABELS, HIRING_DISCLAIMER, PUBLIC_JOB_COLUMNS } from "@/lib/jobs/constants";
import { JOB_MESSAGES } from "@/lib/jobs/messages";
import { embedded, formatJobPay, formatShiftWhen } from "@/lib/jobs/present";
import { canWorkerTransition, type ApplicationStatus } from "@/lib/jobs/state";
import { workerNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireArea("worker");
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: application } = await supabase.from("applications").select("id, job_id, status, cover_note, created_at").eq("id", id).maybeSingle();
  if (!application) notFound();
  const [{ data: job }, { data: siteRows }] = await Promise.all([
    supabase.from("jobs").select(`${PUBLIC_JOB_COLUMNS}, organizations(name, verification_status)`).eq("id", application.job_id).maybeSingle(),
    supabase.rpc("job_private_site", { p_job_id: application.job_id }),
  ]);
  if (!job) notFound();
  const status = application.status as ApplicationStatus;
  const org = embedded(job.organizations);
  const site = siteRows?.[0];
  const returnTo = `/worker/applications/${application.id}`;

  return (
    <AppShell ctx={ctx} title="Worker" nav={workerNav}>
      <Notice code={sp.notice} tone="info" messages={JOB_MESSAGES} />
      <Notice code={sp.error} messages={JOB_MESSAGES} />
      <p className="mt-2 text-sm">
        <Link href="/worker/applications" className="font-semibold underline">
          All applications
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">{job.title}</h1>
      <p className="mt-1 text-sm font-semibold text-slate-900">{APPLICATION_LABELS[status] ?? status}</p>
      <p className="mt-3 text-base font-semibold">{formatJobPay(job.pay_type, job.pay_min_cents, job.pay_max_cents)}</p>
      <p className="mt-1 text-sm text-slate-700">{formatShiftWhen(job.starts_at, job.ends_at, job.shift_period)}</p>
      <p className="mt-1 text-sm text-slate-600">{[job.city, job.county].filter(Boolean).join(" · ")}</p>
      <p className="mt-2 text-sm text-slate-800">
        {org?.name ?? "Employer"}
        {org?.verification_status === "verified" && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900">Verified employer</span>}
      </p>
      {application.cover_note && <p className="mt-3 text-sm text-slate-700">Your note: {application.cover_note}</p>}
      <p className="mt-3 text-sm text-slate-600">{HIRING_DISCLAIMER}</p>
      {site?.site_address_private && (
        <section className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="font-semibold text-emerald-950">Site address</h2>
          <p className="mt-1 text-sm text-emerald-950">{site.site_address_private}</p>
        </section>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/jobs/${job.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold">
          View shift
        </Link>
        {canWorkerTransition(status, "withdrawn") && (
          <form action={withdrawApplication}>
            <input type="hidden" name="applicationId" value={application.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold">
              Withdraw
            </button>
          </form>
        )}
        {canWorkerTransition(status, "accepted") && (
          <>
            <form action={acceptOffer}>
              <input type="hidden" name="applicationId" value={application.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button type="submit" className="min-h-11 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
                Accept offer
              </button>
            </form>
            <form action={declineOffer}>
              <input type="hidden" name="applicationId" value={application.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold">
                Decline offer
              </button>
            </form>
          </>
        )}
      </div>
    </AppShell>
  );
}
