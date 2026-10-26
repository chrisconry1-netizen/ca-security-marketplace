"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { employerErrorCode } from "@/lib/employer/messages";
import { formString, formStrings } from "@/lib/form";
import { marketplaceErrorCode } from "@/lib/jobs/messages";
import { JOB_STATUSES, type JobStatus } from "@/lib/jobs/state";
import { jobFormSchema, jobReadyToPublish, jobWriteFromForm } from "@/lib/jobs/validation";
import { createClient } from "@/lib/supabase/server";
import { requestMeta } from "@/server/audit/audit";
import { requireArea } from "@/server/auth/guards";

function member(ctx: { orgMemberships: { organization_id: string }[] }, orgId: string) {
  return ctx.orgMemberships.some((membership) => membership.organization_id === orgId);
}

export async function saveJob(fd: FormData) {
  const ctx = await requireArea("employer");
  const organizationId = formString(fd, "organizationId");
  const jobId = formString(fd, "jobId");
  const back = jobId ? `/employer/jobs/${jobId}/edit` : `/employer/jobs/new?org=${organizationId}`;
  if (!member(ctx, organizationId)) redirect("/forbidden");

  const parsed = jobFormSchema.safeParse({
    title: formString(fd, "title"),
    description: formString(fd, "description"),
    jobType: formString(fd, "jobType"),
    category: formString(fd, "category"),
    armed: formString(fd, "armed") === "yes",
    urgency: formString(fd, "urgency"),
    city: formString(fd, "city"),
    county: formString(fd, "county"),
    postalCode: formString(fd, "postalCode"),
    siteAddress: formString(fd, "siteAddress"),
    startDate: formString(fd, "startDate"),
    startTime: formString(fd, "startTime"),
    endDate: formString(fd, "endDate"),
    endTime: formString(fd, "endTime"),
    recurrenceDays: formStrings(fd, "recurrenceDays"),
    payType: formString(fd, "payType"),
    payMin: formString(fd, "payMin"),
    payMax: formString(fd, "payMax"),
    workersNeeded: formString(fd, "workersNeeded"),
    minYears: formString(fd, "minYears"),
    uniformNotes: formString(fd, "uniformNotes"),
    vehicleRequired: formString(fd, "vehicleRequired") === "yes",
    equipmentNotes: formString(fd, "equipmentNotes"),
    deadlineDate: formString(fd, "deadlineDate"),
    deadlineTime: formString(fd, "deadlineTime"),
    credentialTypeIds: formStrings(fd, "credentialTypeIds"),
    intent: formString(fd, "intent") === "publish" ? "publish" : "draft",
  });
  if (!parsed.success) redirect(`${back}?error=invalid_input`);
  const write = jobWriteFromForm(parsed.data);
  if (!write) redirect(`${back}?error=invalid_input`);

  const supabase = await createClient();
  const row = {
    title: write.title,
    description: write.description,
    job_type: write.job_type,
    category: write.category,
    is_armed: write.is_armed,
    urgency: write.urgency,
    city: write.city,
    county: write.county,
    postal_code: write.postal_code,
    starts_at: write.starts_at,
    ends_at: write.ends_at,
    recurrence_rule: write.recurrence_rule,
    pay_type: write.pay_type,
    pay_min_cents: write.pay_min_cents,
    pay_max_cents: write.pay_max_cents,
    workers_needed: write.workers_needed,
    min_years_experience: write.min_years_experience,
    uniform_notes: write.uniform_notes,
    vehicle_required: write.vehicle_required,
    equipment_notes: write.equipment_notes,
    application_deadline: write.application_deadline,
  };

  let id = jobId;
  if (id) {
    const { data, error } = await supabase.from("jobs").update(row).eq("id", id).eq("organization_id", organizationId).select("id");
    if (error || !data?.length) {
      console.error("job.update_failed", error?.code);
      redirect(`${back}?error=invalid_input`);
    }
  } else {
    const { data, error } = await supabase
      .from("jobs")
      .insert({ ...row, organization_id: organizationId, created_by: ctx.userId, status: "draft" })
      .select("id")
      .single();
    if (error || !data) {
      console.error("job.create_failed", error?.code);
      redirect(`${back}?error=invalid_input`);
    }
    id = data.id;
  }

  if (write.site_address) {
    const { error } = await supabase.from("job_private_locations").upsert({ job_id: id, site_address: write.site_address });
    if (error) {
      console.error("job.address_failed", error.code);
      redirect(`/employer/jobs/${id}?error=invalid_input`);
    }
  } else {
    const { error } = await supabase.from("job_private_locations").delete().eq("job_id", id);
    if (error) {
      console.error("job.address_clear_failed", error.code);
      redirect(`/employer/jobs/${id}?error=invalid_input`);
    }
  }

  const { error: requirementError } = await supabase.rpc("set_job_requirements", {
    p_job_id: id,
    p_credential_type_ids: write.credential_type_ids,
  });
  if (requirementError) {
    console.error("job.requirements_failed", requirementError.code);
    redirect(`/employer/jobs/${id}?error=invalid_input`);
  }

  if (write.intent === "publish") {
    if (!jobReadyToPublish(write)) redirect(`/employer/jobs/${id}?error=job_incomplete`);
    const meta = await requestMeta();
    const { data: status, error } = await supabase.rpc("transition_job", {
      p_job_id: id,
      p_target: "published",
      p_user_agent: meta.user_agent,
      p_request_id: meta.request_id,
      p_ip: meta.ip_address,
    });
    if (error) {
      console.error("job.publish_failed", error.code);
      redirect(`/employer/jobs/${id}?error=${employerErrorCode(error.message)}`);
    }
    redirect(`/employer/jobs/${id}?notice=${status === "pending_review" ? "job_pending" : "job_published"}`);
  }
  redirect(`/employer/jobs/${id}?notice=job_saved`);
}

export async function transitionJobStatus(fd: FormData) {
  const ctx = await requireArea("employer");
  const jobId = formString(fd, "jobId");
  const target = formString(fd, "target");
  if (!(JOB_STATUSES as readonly string[]).includes(target)) redirect(`/employer/jobs/${jobId}?error=invalid_input`);
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("organization_id").eq("id", jobId).maybeSingle();
  if (!job || !member(ctx, job.organization_id)) redirect("/forbidden");
  const meta = await requestMeta();
  const { data: status, error } = await supabase.rpc("transition_job", {
    p_job_id: jobId,
    p_target: target as JobStatus,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) {
    console.error("job.transition_failed", error.code);
    redirect(`/employer/jobs/${jobId}?error=${employerErrorCode(error.message)}`);
  }
  const notice = status === "pending_review" && target === "published" ? "job_pending" : status === "published" ? "job_published" : "saved";
  redirect(`/employer/jobs/${jobId}?notice=${notice}`);
}

const EMPLOYER_STATUSES = new Set(["reviewing", "shortlisted", "interview", "offered", "rejected"]);

export async function setApplicationStatus(fd: FormData) {
  await requireArea("employer");
  const applicationId = formString(fd, "applicationId");
  const status = formString(fd, "status");
  const returnTo = safeNextPath(formString(fd, "returnTo"), "/employer/jobs");
  if (!applicationId || !EMPLOYER_STATUSES.has(status)) redirect(`${returnTo}?error=invalid_input`);
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("employer_set_application_status", {
    p_application_id: applicationId,
    p_status: status,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) redirect(`${returnTo}?error=${marketplaceErrorCode(error.message)}`);
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}notice=status_updated`);
}
