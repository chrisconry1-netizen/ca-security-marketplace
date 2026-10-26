"use server";

import { redirect } from "next/navigation";
import { formString } from "@/lib/form";
import { requireArea } from "@/server/auth/guards";
import { runMatch } from "@/server/matching/run";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function refreshWorkerMatches() {
  const ctx = await requireArea("worker");
  const result = await runMatch({ actorId: ctx.userId, direction: "jobs_for_worker" });
  if (!result.ok) redirect(`/worker/recommended?error=${result.error}`);
  redirect("/worker/recommended?notice=matches_refreshed");
}

export async function refreshJobMatches(fd: FormData) {
  const ctx = await requireArea("employer");
  const jobId = formString(fd, "jobId");
  const back = UUID.test(jobId) ? `/employer/jobs/${jobId}/suggestions` : "/employer/jobs";
  if (!UUID.test(jobId)) redirect("/employer/jobs?error=invalid_input");
  const result = await runMatch({ actorId: ctx.userId, direction: "workers_for_job", jobId });
  if (!result.ok) redirect(`${back}?error=${result.error}`);
  redirect(`${back}?notice=matches_refreshed`);
}
