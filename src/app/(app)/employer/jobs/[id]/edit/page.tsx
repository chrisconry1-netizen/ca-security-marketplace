import Link from "next/link";
import { redirect } from "next/navigation";
import { JobForm } from "@/components/job-form";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/ui";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { recurrenceDays } from "@/lib/jobs/constants";
import { isoToPacificParts } from "@/lib/jobs/time";
import { JOB_COLUMNS } from "@/lib/jobs/validation";
import { centsToDollars } from "@/lib/workers/validation";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { saveJob } from "../../actions";

export default async function EditJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select(JOB_COLUMNS).eq("id", id).maybeSingle();
  if (!job || !ctx.orgMemberships.some((membership) => membership.organization_id === job.organization_id)) redirect("/employer/jobs");
  if (job.status !== "draft" && job.status !== "pending_review") redirect(`/employer/jobs/${id}`);
  const [{ data: location }, { data: requirements }, { data: types }] = await Promise.all([
    supabase.from("job_private_locations").select("site_address").eq("job_id", id).maybeSingle(),
    supabase.from("job_requirements").select("credential_type_id").eq("job_id", id),
    supabase.from("credential_types").select("id, name").eq("is_active", true).order("name"),
  ]);
  const start = isoToPacificParts(job.starts_at);
  const end = isoToPacificParts(job.ends_at);
  const deadline = isoToPacificParts(job.application_deadline);

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.error)} messages={EMPLOYER_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Edit job</h1>
      <Link href={`/employer/jobs/${id}`} className="mt-2 inline-block text-sm font-medium text-slate-700 underline">Back to job</Link>
      <JobForm
        action={saveJob}
        organizationId={job.organization_id}
        jobId={job.id}
        credentialTypes={types ?? []}
        defaults={{
          title: job.title,
          description: job.description,
          jobType: job.job_type,
          category: job.category,
          armed: job.is_armed,
          urgency: job.urgency,
          city: job.city ?? "",
          county: job.county ?? "",
          postalCode: job.postal_code ?? "",
          siteAddress: location?.site_address ?? "",
          startDate: start.date,
          startTime: start.time,
          endDate: end.date,
          endTime: end.time,
          recurrenceDays: recurrenceDays(job.recurrence_rule),
          payType: job.pay_type,
          payMin: centsToDollars(job.pay_min_cents),
          payMax: centsToDollars(job.pay_max_cents),
          workersNeeded: job.workers_needed,
          minYears: job.min_years_experience == null ? "" : String(job.min_years_experience),
          uniformNotes: job.uniform_notes ?? "",
          vehicleRequired: job.vehicle_required,
          equipmentNotes: job.equipment_notes ?? "",
          deadlineDate: deadline.date,
          deadlineTime: deadline.time,
          credentialTypeIds: (requirements ?? []).map((row) => row.credential_type_id).filter((value): value is string => Boolean(value)),
        }}
      />
    </AppShell>
  );
}
