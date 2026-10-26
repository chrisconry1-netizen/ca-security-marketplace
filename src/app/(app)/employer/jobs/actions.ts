"use server";

import { redirect } from "next/navigation";
import { formString, formStrings } from "@/lib/form";
import { marketplaceErrorCode } from "@/lib/jobs/messages";
import { jobDraftSchema, jobErrorCode, optionalCoord } from "@/lib/jobs/validation";
import { dollarsToCents } from "@/lib/workers/validation";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { requestMeta } from "@/server/audit/audit";
import { requireArea } from "@/server/auth/guards";

function fail(path: string, code: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${code}`);
}

function localTime(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match?.[1] ?? value.trim();
}

export async function saveJobDraft(fd: FormData) {
  const ctx = await requireArea("employer");
  const organizationId = formString(fd, "organizationId");
  const jobId = formString(fd, "jobId");
  const returnTo = safeNextPath(formString(fd, "returnTo"), jobId ? `/employer/jobs/${jobId}` : "/employer/jobs/new");
  if (!ctx.orgMemberships.some((membership) => membership.organization_id === organizationId)) fail(returnTo, "not_a_member");

  const parsed = jobDraftSchema.safeParse({
    title: formString(fd, "title"),
    description: formString(fd, "description"),
    jobType: formString(fd, "jobType"),
    category: formString(fd, "category"),
    armed: formString(fd, "armed") || "no",
    urgency: formString(fd, "urgency") || "normal",
    city: formString(fd, "city"),
    county: formString(fd, "county"),
    postalCode: formString(fd, "postalCode"),
    siteAddress: formString(fd, "siteAddress"),
    siteLat: formString(fd, "siteLat"),
    siteLng: formString(fd, "siteLng"),
    approxLat: formString(fd, "approxLat"),
    approxLng: formString(fd, "approxLng"),
    startsLocal: localTime(formString(fd, "startsLocal")),
    endsLocal: localTime(formString(fd, "endsLocal")),
    payType: formString(fd, "payType") || "hourly",
    payMin: formString(fd, "payMin"),
    payMax: formString(fd, "payMax"),
    workersNeeded: formString(fd, "workersNeeded") || "1",
    minYears: formString(fd, "minYears"),
    uniformNotes: formString(fd, "uniformNotes"),
    vehicleRequired: fd.get("vehicleRequired") === "on",
    equipmentNotes: formString(fd, "equipmentNotes"),
    deadlineLocal: localTime(formString(fd, "deadlineLocal")),
    requiredCodes: formStrings(fd, "requiredCodes"),
    optionalCodes: formStrings(fd, "optionalCodes"),
  });
  if (!parsed.success) fail(returnTo, jobErrorCode(parsed.error));

  const siteLat = optionalCoord(parsed.data.siteLat);
  const siteLng = optionalCoord(parsed.data.siteLng);
  const approxLat = optionalCoord(parsed.data.approxLat);
  const approxLng = optionalCoord(parsed.data.approxLng);
  if ([siteLat, siteLng, approxLat, approxLng].includes("invalid")) fail(returnTo, "invalid_input");

  const payMin = parsed.data.payMin ? dollarsToCents(parsed.data.payMin) : null;
  const payMax = parsed.data.payMax ? dollarsToCents(parsed.data.payMax) : null;
  if ((parsed.data.payMin && payMin == null) || (parsed.data.payMax && payMax == null)) fail(returnTo, "invalid_input");

  const supabase = await createClient();
  const meta = await requestMeta();
  const { data, error } = await supabase.rpc("save_job_draft", {
    p_organization_id: organizationId,
    p_job_id: jobId || null,
    p_title: parsed.data.title,
    p_description: parsed.data.description,
    p_job_type: parsed.data.jobType,
    p_category: parsed.data.category,
    p_is_armed: parsed.data.armed === "yes",
    p_urgency: parsed.data.urgency,
    p_city: parsed.data.city || null,
    p_county: parsed.data.county || null,
    p_postal_code: parsed.data.postalCode || null,
    p_site_address_private: parsed.data.siteAddress || null,
    p_site_lat: siteLat,
    p_site_lng: siteLng,
    p_approx_lat: approxLat,
    p_approx_lng: approxLng,
    p_starts_local: parsed.data.startsLocal || null,
    p_ends_local: parsed.data.endsLocal || null,
    p_pay_type: parsed.data.payType,
    p_pay_min_cents: payMin,
    p_pay_max_cents: payMax,
    p_workers_needed: parsed.data.workersNeeded,
    p_min_years: parsed.data.minYears === "" ? null : parsed.data.minYears,
    p_uniform_notes: parsed.data.uniformNotes || null,
    p_vehicle_required: parsed.data.vehicleRequired,
    p_equipment_notes: parsed.data.equipmentNotes || null,
    p_deadline_local: parsed.data.deadlineLocal || null,
    p_required_codes: parsed.data.requiredCodes,
    p_optional_codes: parsed.data.optionalCodes,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error || !data) fail(returnTo, marketplaceErrorCode(error?.message));
  redirect(`/employer/jobs/${data}?notice=draft_saved`);
}

export async function publishJob(fd: FormData) {
  await requireArea("employer");
  const jobId = formString(fd, "jobId");
  const returnTo = safeNextPath(formString(fd, "returnTo"), jobId ? `/employer/jobs/${jobId}` : "/employer/jobs");
  if (!jobId) fail(returnTo, "not_found");
  const supabase = await createClient();
  const meta = await requestMeta();
  const { data, error } = await supabase.rpc("publish_job", {
    p_job_id: jobId,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) fail(returnTo, marketplaceErrorCode(error.message));
  const notice = data === "published" ? "published" : data === "pending_review" ? "pending_review" : "generic";
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}notice=${notice}`);
}

const EMPLOYER_STATUSES = new Set(["reviewing", "shortlisted", "interview", "offered", "rejected"]);

export async function setApplicationStatus(fd: FormData) {
  await requireArea("employer");
  const applicationId = formString(fd, "applicationId");
  const status = formString(fd, "status");
  const returnTo = safeNextPath(formString(fd, "returnTo"), "/employer/jobs");
  if (!applicationId || !EMPLOYER_STATUSES.has(status)) fail(returnTo, "illegal_transition");
  const supabase = await createClient();
  const meta = await requestMeta();
  const { error } = await supabase.rpc("employer_set_application_status", {
    p_application_id: applicationId,
    p_status: status,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error) fail(returnTo, marketplaceErrorCode(error.message));
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}notice=status_updated`);
}
