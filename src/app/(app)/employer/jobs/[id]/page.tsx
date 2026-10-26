import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { JobDraftForm, type JobFormDefaults } from "@/components/jobs/job-form";
import { Notice } from "@/components/ui";
import { APPLICATION_LABELS, EMPLOYER_ACTION_LABELS, HIRING_DISCLAIMER, PAY_DISCLAIMER, PUBLIC_JOB_COLUMNS } from "@/lib/jobs/constants";
import { JOB_MESSAGES } from "@/lib/jobs/messages";
import { categoryLabel, embedded, expiryLabel, formatJobPay, formatShiftWhen, jobTypeLabel, pacificDate, pacificLocalInput } from "@/lib/jobs/present";
import type { ApplicationStatus } from "@/lib/jobs/state";
import { employerTargets } from "@/lib/jobs/state";
import { employerNav } from "@/lib/nav";
import { centsToDollars } from "@/lib/workers/validation";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { publishJob, setApplicationStatus } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Applicant {
  application_id: string;
  status: ApplicationStatus;
  cover_note: string | null;
  display_name: string | null;
  city: string | null;
  county: string | null;
  years_experience: number | null;
  verified_credentials: unknown;
}

function credentialCards(value: unknown): { code: string; name: string; expires_on: string | null }[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { code?: unknown; name?: unknown; expires_on?: unknown };
    if (typeof row.code !== "string" || typeof row.name !== "string") return [];
    return [{ code: row.code, name: row.name, expires_on: typeof row.expires_on === "string" ? row.expires_on : null }];
  });
}

export default async function EmployerJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireArea("employer");
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select(PUBLIC_JOB_COLUMNS).eq("id", id).maybeSingle();
  if (!job || !ctx.orgMemberships.some((membership) => membership.organization_id === job.organization_id)) notFound();

  const [{ data: orgs }, { data: types }, { data: requirements }, { data: siteRows }, { data: applicants, error: applicantError }] = await Promise.all([
    supabase.from("organizations").select("id, name").eq("id", job.organization_id),
    supabase.from("credential_types").select("code, name").eq("is_active", true).order("name"),
    supabase.from("job_requirements").select("is_mandatory, credential_types(code, name)").eq("job_id", id),
    supabase.rpc("job_private_site", { p_job_id: id }),
    supabase.rpc("job_applicants", { p_job_id: id }),
  ]);
  const site = siteRows?.[0];
  const shiftDate = pacificDate(job.starts_at);
  const requiredCodes = (requirements ?? []).flatMap((row) => {
    const type = embedded(row.credential_types);
    return row.is_mandatory && type?.code ? [type.code] : [];
  });
  const optionalCodes = (requirements ?? []).flatMap((row) => {
    const type = embedded(row.credential_types);
    return !row.is_mandatory && type?.code ? [type.code] : [];
  });
  const editable = job.status === "draft" || job.status === "pending_review";
  const defaults: JobFormDefaults = {
    jobId: job.id,
    organizationId: job.organization_id,
    title: job.title,
    description: job.description,
    jobType: job.job_type,
    category: job.category,
    armed: job.is_armed ? "yes" : "no",
    urgency: job.urgency,
    city: job.city ?? "",
    county: job.county ?? "",
    postalCode: job.postal_code ?? "",
    siteAddress: site?.site_address_private ?? "",
    siteLat: site?.site_lat == null ? "" : String(site.site_lat),
    siteLng: site?.site_lng == null ? "" : String(site.site_lng),
    approxLat: job.approx_lat == null ? "" : String(job.approx_lat),
    approxLng: job.approx_lng == null ? "" : String(job.approx_lng),
    startsLocal: pacificLocalInput(job.starts_at),
    endsLocal: pacificLocalInput(job.ends_at),
    payType: job.pay_type,
    payMin: centsToDollars(job.pay_min_cents),
    payMax: centsToDollars(job.pay_max_cents),
    workersNeeded: String(job.workers_needed),
    minYears: job.min_years_experience == null ? "" : String(job.min_years_experience),
    uniformNotes: job.uniform_notes ?? "",
    vehicleRequired: job.vehicle_required,
    equipmentNotes: job.equipment_notes ?? "",
    deadlineLocal: pacificLocalInput(job.application_deadline),
    requiredCodes,
    optionalCodes,
  };

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={sp.notice} tone="info" messages={JOB_MESSAGES} />
      <Notice code={sp.error} messages={JOB_MESSAGES} />
      <p className="mt-2 text-sm text-slate-500">
        <Link href="/employer/jobs" className="underline">
          All shifts
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">{job.title}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {job.status} · {categoryLabel(job.category)} · {job.is_armed ? "Armed" : "Unarmed"} · {jobTypeLabel(job.job_type)}
      </p>
      <p className="mt-3 text-base font-semibold text-slate-900">{formatJobPay(job.pay_type, job.pay_min_cents, job.pay_max_cents)}</p>
      <p className="mt-1 text-sm text-slate-700">{formatShiftWhen(job.starts_at, job.ends_at, job.shift_period)}</p>
      <p className="mt-1 text-sm text-slate-600">{[job.city, job.county, job.postal_code].filter(Boolean).join(" · ")}</p>
      <p className="mt-3 text-sm text-slate-600">{PAY_DISCLAIMER}</p>
      {site?.site_address_private && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Site address</h2>
          <p className="mt-1 text-sm text-slate-800">{site.site_address_private}</p>
          <p className="mt-1 text-xs text-slate-500">Shown to a worker only after they accept an offer. It is not on the public shift page.</p>
        </section>
      )}
      {job.status === "published" && (
        <Link href={`/jobs/${job.id}`} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold underline">
          View public page
        </Link>
      )}
      {editable && (
        <form action={publishJob} className="mt-4">
          <input type="hidden" name="jobId" value={job.id} />
          <input type="hidden" name="returnTo" value={`/employer/jobs/${job.id}`} />
          <button type="submit" className="min-h-11 w-full rounded-lg border border-slate-900 px-4 py-3 text-base font-semibold text-slate-900">
            Publish shift
          </button>
        </form>
      )}
      <section className="mt-6">
        <h2 className="text-lg font-bold text-slate-900">Applicants</h2>
        <p className="mt-1 text-sm text-slate-600">{HIRING_DISCLAIMER} Nothing here accepts or rejects an application on its own.</p>
        {applicantError && <p className="mt-2 text-sm text-red-800">Applicants could not be loaded.</p>}
        <div className="mt-3 space-y-3">
          {((applicants ?? []) as Applicant[]).map((applicant) => {
            const credentials = credentialCards(applicant.verified_credentials);
            return (
              <article key={applicant.application_id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-slate-900">{applicant.display_name || "Worker"}</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{APPLICATION_LABELS[applicant.status] ?? applicant.status}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {[applicant.city, applicant.county].filter(Boolean).join(" · ") || "Area not listed"}
                  {applicant.years_experience != null ? ` · ${applicant.years_experience} years` : ""}
                </p>
                {applicant.cover_note && <p className="mt-2 text-sm text-slate-800">{applicant.cover_note}</p>}
                <h4 className="mt-3 text-sm font-semibold text-slate-900">Verified credentials</h4>
                {credentials.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-600">No verified credentials on file.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm text-slate-700">
                    {credentials.map((credential) => (
                      <li key={credential.code}>
                        {credential.name} · {expiryLabel(credential.expires_on, shiftDate)}
                      </li>
                    ))}
                  </ul>
                )}
                {employerTargets(applicant.status).length > 0 && (
                  <form action={setApplicationStatus} className="mt-3 flex flex-wrap gap-2">
                    <input type="hidden" name="applicationId" value={applicant.application_id} />
                    <input type="hidden" name="returnTo" value={`/employer/jobs/${job.id}`} />
                    {employerTargets(applicant.status).map((status) => (
                      <button key={status} type="submit" name="status" value={status} className="min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                        {EMPLOYER_ACTION_LABELS[status]}
                      </button>
                    ))}
                  </form>
                )}
              </article>
            );
          })}
          {(applicants ?? []).length === 0 && !applicantError && <p className="text-sm text-slate-600">No applications yet.</p>}
        </div>
      </section>
      {editable && (
        <div className="mt-6">
          <h2 className="text-lg font-bold text-slate-900">Edit draft</h2>
          <div className="mt-3">
            <JobDraftForm organizations={orgs ?? []} types={types ?? []} defaults={defaults} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
