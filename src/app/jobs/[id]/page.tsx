import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareJobButton } from "@/components/jobs/share-button";
import { Notice } from "@/components/ui";
import { acceptOffer, applyToJob, declineOffer, saveJob, unsaveJob, withdrawApplication } from "@/app/jobs/actions";
import { APPLICATION_LABELS, HIRING_DISCLAIMER, LOCATION_DISCLAIMER, PAY_DISCLAIMER, PUBLIC_JOB_COLUMNS } from "@/lib/jobs/constants";
import { applyBlockReason } from "@/lib/jobs/eligibility";
import { JOB_MESSAGES } from "@/lib/jobs/messages";
import { categoryLabel, embedded, formatJobPay, formatShiftWhen, jobTypeLabel, pacificDate } from "@/lib/jobs/present";
import { canWorkerTransition, type ApplicationStatus } from "@/lib/jobs/state";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/server/auth/guards";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const ctx = await getSessionContext();
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(`${PUBLIC_JOB_COLUMNS}, organizations(name, verification_status)`)
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  const worker = ctx?.roles.includes("worker") ?? false;
  const member = ctx?.orgMemberships.some((membership) => membership.organization_id === job.organization_id) ?? false;
  const [{ data: requirements }, applicationResult, savedResult, credentialResult, siteResult] = await Promise.all([
    supabase.from("job_requirements").select("is_mandatory, requirement_text, credential_types(code, name)").eq("job_id", id),
    worker ? supabase.from("applications").select("id, status, cover_note").eq("job_id", id).eq("worker_id", ctx!.userId).maybeSingle() : Promise.resolve({ data: null }),
    worker ? supabase.from("saved_jobs").select("job_id").eq("job_id", id).maybeSingle() : Promise.resolve({ data: null }),
    worker
      ? supabase.from("credentials").select("status, expires_on, credential_types(code)").eq("worker_id", ctx!.userId)
      : Promise.resolve({ data: [] }),
    ctx ? supabase.rpc("job_private_site", { p_job_id: id }) : Promise.resolve({ data: [] }),
  ]);

  const org = embedded(job.organizations);
  const application = applicationResult.data;
  const status = application?.status as ApplicationStatus | undefined;
  const shiftDate = pacificDate(job.starts_at);
  const mandatory = (requirements ?? []).flatMap((row) => {
    const type = embedded(row.credential_types);
    return row.is_mandatory && type?.code ? [type.code] : [];
  });
  const block = worker
    ? applyBlockReason({
        armed: job.is_armed,
        mandatoryCodes: mandatory,
        shiftDate,
        credentials: (credentialResult.data ?? []).map((row) => ({
          code: embedded(row.credential_types)?.code ?? "",
          status: row.status,
          expiresOn: row.expires_on,
        })),
      })
    : null;
  const site = siteResult.data?.[0];
  const returnTo = `/jobs/${id}`;

  return (
    <main className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/jobs" className="text-sm font-semibold text-slate-900">
            All shifts
          </Link>
          <Link href={ctx ? "/dashboard" : `/login?next=${encodeURIComponent(returnTo)}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">
            {ctx ? "Account" : "Sign in"}
          </Link>
        </div>
      </header>
      <article className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <Notice code={sp.notice} tone="info" messages={JOB_MESSAGES} />
        <Notice code={sp.error} messages={JOB_MESSAGES} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{job.title}</h1>
            <p className="mt-1 text-sm text-slate-600">{[job.city, job.county].filter(Boolean).join(" · ") || "California"}</p>
          </div>
          {job.urgency === "urgent" && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-900">Urgent</span>}
        </div>
        <p className="text-xl font-semibold text-slate-900">{formatJobPay(job.pay_type, job.pay_min_cents, job.pay_max_cents)}</p>
        <p className="text-sm text-slate-700">{formatShiftWhen(job.starts_at, job.ends_at, job.shift_period)}</p>
        <p className="text-sm text-slate-700">
          {categoryLabel(job.category)} · {job.is_armed ? "Armed" : "Unarmed"} · {jobTypeLabel(job.job_type)}
          {job.workers_needed > 1 ? ` · ${job.workers_needed} workers` : ""}
          {job.vehicle_required ? " · Vehicle required" : ""}
          {job.requires_off_duty_le ? " · Recorded off-duty approval required" : ""}
          {job.min_years_experience != null ? ` · ${job.min_years_experience}+ years` : ""}
        </p>
        <p className="text-sm text-slate-800">
          {org?.name ?? "Employer"}
          {org?.verification_status === "verified" && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900">Verified employer</span>}
        </p>
        <p className="text-sm text-slate-600">{PAY_DISCLAIMER}</p>
        <p className="text-sm text-slate-600">{HIRING_DISCLAIMER}</p>
        <p className="text-sm text-slate-600">{LOCATION_DISCLAIMER}</p>
        {job.status !== "published" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">This shift is not on the public list.</p>}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">About this shift</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{job.description}</p>
          {job.uniform_notes && <p className="mt-3 text-sm text-slate-700">Uniform: {job.uniform_notes}</p>}
          {job.equipment_notes && <p className="mt-2 text-sm text-slate-700">Equipment: {job.equipment_notes}</p>}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Requirements</h2>
          {job.is_armed && (
            <p className="mt-2 text-sm text-slate-800">Armed shifts stay closed until a person has verified both a CA Guard Registration and an Exposed Firearm Permit, and neither is expired on the shift date.</p>
          )}
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {(requirements ?? []).map((row, index) => {
              const type = embedded(row.credential_types);
              const label = type?.name ?? row.requirement_text ?? "Requirement";
              return (
                <li key={`${type?.code ?? "text"}-${index}`}>
                  {label}
                  {row.is_mandatory ? " · required" : " · optional"}
                </li>
              );
            })}
            {(requirements ?? []).length === 0 && !job.is_armed && <li>No credential requirement listed.</li>}
          </ul>
        </section>
        {site?.site_address_private && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <h2 className="font-semibold text-emerald-950">Site address</h2>
            <p className="mt-1 text-sm text-emerald-950">{site.site_address_private}</p>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          {job.status === "published" && <ShareJobButton title={job.title} path={returnTo} />}
          {worker && (
            <form action={savedResult.data ? unsaveJob : saveJob}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900">
                {savedResult.data ? "Unsave shift" : "Save shift"}
              </button>
            </form>
          )}
          {member && (
            <Link href={`/employer/jobs/${job.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold">
              Manage applicants
            </Link>
          )}
        </div>
        {worker && application && status && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Your application</h2>
            <p className="mt-1 text-sm text-slate-700">{APPLICATION_LABELS[status] ?? status}</p>
            <Link href={`/worker/applications/${application.id}`} className="mt-2 inline-flex text-sm font-semibold underline">
              Open application
            </Link>
            {canWorkerTransition(status, "withdrawn") && (
              <form action={withdrawApplication} className="mt-3">
                <input type="hidden" name="applicationId" value={application.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold">
                  Withdraw
                </button>
              </form>
            )}
            {canWorkerTransition(status, "accepted") && (
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={acceptOffer}>
                  <input type="hidden" name="applicationId" value={application.id} />
                  <input type="hidden" name="returnTo" value={`/worker/applications/${application.id}`} />
                  <button type="submit" className="min-h-11 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
                    Accept offer
                  </button>
                </form>
                <form action={declineOffer}>
                  <input type="hidden" name="applicationId" value={application.id} />
                  <input type="hidden" name="returnTo" value={`/worker/applications/${application.id}`} />
                  <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold">
                    Decline offer
                  </button>
                </form>
              </div>
            )}
          </section>
        )}
        {worker && !application && job.status === "published" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Apply</h2>
            {block ? (
              <p className="mt-2 text-sm text-slate-800">{JOB_MESSAGES[block]}</p>
            ) : (
              <form action={applyToJob} className="mt-3 space-y-3">
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <label className="block text-sm font-medium text-slate-800">
                  Note for the employer
                  <textarea name="note" maxLength={4000} className="mt-1 block min-h-24 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" />
                </label>
                <button type="submit" className="min-h-11 w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
                  Apply to this shift
                </button>
              </form>
            )}
          </section>
        )}
        {!ctx && job.status === "published" && (
          <Link href={`/login?next=${encodeURIComponent(returnTo)}`} className="inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
            Sign in to apply
          </Link>
        )}
      </article>
    </main>
  );
}
