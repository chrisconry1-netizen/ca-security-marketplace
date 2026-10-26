"use server";

import { redirect } from "next/navigation";
import { formString } from "@/lib/form";
import { marketplaceErrorCode } from "@/lib/jobs/messages";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { requestMeta } from "@/server/audit/audit";
import { requireArea } from "@/server/auth/guards";

function fail(path: string, code: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${code}`);
}

export async function saveJob(fd: FormData) {
  const ctx = await requireArea("worker");
  const jobId = formString(fd, "jobId");
  const returnTo = safeNextPath(formString(fd, "returnTo"), jobId ? `/jobs/${jobId}` : "/worker/shifts");
  if (!jobId) fail(returnTo, "not_found");
  const supabase = await createClient();
  const { error } = await supabase.from("saved_jobs").insert({ worker_id: ctx.userId, job_id: jobId });
  if (error && error.code !== "23505") fail(returnTo, "generic");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}notice=saved`);
}

export async function unsaveJob(fd: FormData) {
  await requireArea("worker");
  const jobId = formString(fd, "jobId");
  const returnTo = safeNextPath(formString(fd, "returnTo"), "/worker/saved");
  if (!jobId) fail(returnTo, "not_found");
  const supabase = await createClient();
  const { error } = await supabase.from("saved_jobs").delete().eq("job_id", jobId);
  if (error) fail(returnTo, "generic");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}notice=unsaved`);
}

export async function applyToJob(fd: FormData) {
  const ctx = await requireArea("worker");
  if (!ctx.roles.includes("worker")) fail("/worker", "workers_only");
  const jobId = formString(fd, "jobId");
  const returnTo = safeNextPath(formString(fd, "returnTo"), jobId ? `/jobs/${jobId}` : "/worker/shifts");
  if (!jobId) fail(returnTo, "not_found");
  const supabase = await createClient();
  const meta = await requestMeta();
  const { data, error } = await supabase.rpc("submit_application", {
    p_job_id: jobId,
    p_note: formString(fd, "note"),
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error || !data) fail(returnTo, marketplaceErrorCode(error?.message));
  redirect(`/worker/applications/${data}?notice=applied`);
}

export async function withdrawApplication(fd: FormData) {
  await requireArea("worker");
  const applicationId = formString(fd, "applicationId");
  const returnTo = safeNextPath(formString(fd, "returnTo"), applicationId ? `/worker/applications/${applicationId}` : "/worker/applications");
  if (!applicationId) fail(returnTo, "not_found");
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("withdraw_application", {
    p_application_id: applicationId,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) fail(returnTo, marketplaceErrorCode(error.message));
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}notice=withdrawn`);
}

export async function acceptOffer(fd: FormData) {
  await requireArea("worker");
  const applicationId = formString(fd, "applicationId");
  const returnTo = safeNextPath(formString(fd, "returnTo"), applicationId ? `/worker/applications/${applicationId}` : "/worker/applications");
  if (!applicationId) fail(returnTo, "not_found");
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("accept_offer", {
    p_application_id: applicationId,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) fail(returnTo, marketplaceErrorCode(error.message));
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}notice=accepted`);
}

export async function declineOffer(fd: FormData) {
  await requireArea("worker");
  const applicationId = formString(fd, "applicationId");
  const returnTo = safeNextPath(formString(fd, "returnTo"), applicationId ? `/worker/applications/${applicationId}` : "/worker/applications");
  if (!applicationId) fail(returnTo, "not_found");
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("decline_offer", {
    p_application_id: applicationId,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) fail(returnTo, marketplaceErrorCode(error.message));
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}notice=declined`);
}
