import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pill, verificationTone } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { APPLICATION_LABELS, EMPLOYER_ACTION_LABELS, jobTypeLabel } from "@/lib/jobs/constants";
import { expiryLabel, pacificDate } from "@/lib/jobs/present";
import { allowedTargets, employerTargets, JOB_STATUSES, jobStatusLabel, type ApplicationStatus, type JobStatus } from "@/lib/jobs/state";
import { formatPacific } from "@/lib/jobs/time";
import { compensationLine, JOB_COLUMNS } from "@/lib/jobs/validation";
import { categoryLabel } from "@/lib/workers/categories";
import { relationName } from "@/lib/workers/present";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { openConversation } from "@/app/(app)/messages/actions";
import { MESSAGING_MESSAGES } from "@/lib/messaging/messages";
import { setApplicationStatus, transitionJobStatus } from "../actions";

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

function asStatus(value: string): JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value) ? (value as JobStatus) : "draft";
}

function actionLabel(target: JobStatus): string {
  if (target === "published") return "Publish";
  if (target === "pending_review") return "Submit for review";
  if (target === "in_progress") return "Mark in progress";
  if (target === "filled") return "Mark filled";
  if (target === "completed") return "Mark completed";
  if (target === "cancelled") return "Cancel job";
  if (target === "expired") return "Mark expired";
  if (target === "draft") return "Return to draft";
  return jobStatusLabel(target);
}

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select(JOB_COLUMNS).eq("id", id).maybeSingle();
  const membership = job ? ctx.orgMemberships.find((item) => item.organization_id === job.organization_id) : undefined;
  const { data: org } = job
    ? await supabase.from("organizations").select("id, name, verification_status").eq("id", job.organization_id).maybeSingle()
    : { data: null };
  const { data: location } = membership
    ? await supabase.from("job_private_locations").select("site_address").eq("job_id", id).maybeSingle()
    : { data: null };
  const { data: requirements } = job
    ? await supabase.from("job_requirements").select("id, credential_types(name)").eq("job_id", id)
    : { data: [] };
  const { data: applicants, error: applicantError } = membership
    ? await supabase.rpc("job_applicants", { p_job_id: id })
    : { data: [], error: null };
  const status = asStatus(job?.status ?? "draft");
  const shiftDate = pacificDate(job?.starts_at ?? null);
  const verified = org?.verification_status === "verified";
  const editable = membership && (status === "draft" || status === "pending_review");

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={{ ...EMPLOYER_MESSAGES, ...MESSAGING_MESSAGES }} />
      <Notice code={queryValue(sp.error)} messages={{ ...EMPLOYER_MESSAGES, ...MESSAGING_MESSAGES }} />
      {!job && <h1 className="mt-2 text-2xl font-bold text-slate-900">Job unavailable</h1>}
      {job && (
        <>
          <div className="mt-2 flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{job.title}</h1>
            <Pill label={jobStatusLabel(status)} tone={verificationTone(status)} />
          </div>
          <p className="mt-2 text-sm text-slate-600">Hiring organization: {org?.name ?? "Organization"}. GuardGig does not employ or dispatch the worker and does not set this wage.</p>
          <section className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
            <p className="whitespace-pre-wrap">{job.description}</p>
            <p>{jobTypeLabel(job.job_type)} · {categoryLabel(job.category)}{job.is_armed ? " · Armed post" : ""}</p>
            <p>Public area: {[job.city, job.county, job.postal_code].filter(Boolean).join(", ") || "Not set"}</p>
            {membership && (
              <p>
                <span className="font-medium text-slate-500">Site street address. </span>
                {location?.site_address || "Not set"}
              </p>
            )}
            <p>{formatPacific(job.starts_at)} – {formatPacific(job.ends_at)}</p>
            {job.recurrence_rule && <p>Repeats {job.recurrence_rule}</p>}
            <p>{compensationLine(job.pay_type, job.pay_min_cents, job.pay_max_cents)} · {job.workers_needed} worker{job.workers_needed === 1 ? "" : "s"}</p>
            {job.min_years_experience != null && <p>Minimum experience: {job.min_years_experience} years</p>}
            {job.uniform_notes && <p>Uniform: {job.uniform_notes}</p>}
            {job.vehicle_required && <p>Vehicle required</p>}
            {job.equipment_notes && <p>Equipment: {job.equipment_notes}</p>}
            <p>Deadline: {formatPacific(job.application_deadline)}</p>
            {(requirements ?? []).length > 0 && (
              <ul className="list-disc pl-5">
                {(requirements ?? []).map((row) => (
                  <li key={row.id}>{relationName(row.credential_types as { name: string } | { name: string }[] | null)}</li>
                ))}
              </ul>
            )}
          </section>
          {job.is_armed && <p className="mt-3 text-sm text-slate-600">An armed post does not confirm a guard card or firearm permit.</p>}
          <div className="mt-4 flex flex-col gap-2">
            {editable && (
              <Link href={`/employer/jobs/${job.id}/edit`} className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-900">Edit job</Link>
            )}
            {membership && allowedTargets(status, verified).map((target) => (
              <form key={target} action={transitionJobStatus}>
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="target" value={target} />
                <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">{actionLabel(target)}</button>
              </form>
            ))}
          </div>
          {membership && (
            <section className="mt-6">
              <h2 className="text-lg font-bold text-slate-900">Applicants</h2>
              <p className="mt-1 text-sm text-slate-600">Nothing here accepts or rejects an application on its own. Credential numbers are not shown.</p>
              {applicantError && <p className="mt-2 text-sm text-red-800">Applicants could not be loaded.</p>}
              <div className="mt-3 space-y-3">
                {((applicants ?? []) as {
                  application_id: string;
                  status: ApplicationStatus;
                  cover_note: string | null;
                  display_name: string | null;
                  city: string | null;
                  county: string | null;
                  years_experience: number | null;
                  verified_credentials: unknown;
                }[]).map((applicant) => {
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
                      <form action={openConversation} className="mt-3">
                        <input type="hidden" name="applicationId" value={applicant.application_id} />
                        <input type="hidden" name="returnTo" value={`/employer/jobs/${job.id}`} />
                        <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900">
                          Message
                        </button>
                      </form>
                      {employerTargets(applicant.status).length > 0 && (
                        <form action={setApplicationStatus} className="mt-3 flex flex-wrap gap-2">
                          <input type="hidden" name="applicationId" value={applicant.application_id} />
                          <input type="hidden" name="returnTo" value={`/employer/jobs/${job.id}`} />
                          {employerTargets(applicant.status).map((next) => (
                            <button key={next} type="submit" name="status" value={next} className="min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                              {EMPLOYER_ACTION_LABELS[next]}
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
          )}
        </>
      )}
    </AppShell>
  );
}
