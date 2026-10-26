/**
 * Application transitions. public.guard_application_write in
 * supabase/migrations/0005_job_marketplace.sql is authoritative.
 * Workers submit, withdraw, accept, or decline. Org members move the
 * review states. Nothing is accepted or rejected automatically.
 */
export const APPLICATION_STATUSES = [
  "submitted",
  "reviewing",
  "shortlisted",
  "interview",
  "offered",
  "accepted",
  "declined",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const WORKER_OPEN = ["submitted", "reviewing", "shortlisted", "interview", "offered"] as const;
const EMPLOYER_FROM = ["submitted", "reviewing", "shortlisted", "interview"] as const;
const EMPLOYER_TO = ["reviewing", "shortlisted", "interview", "offered", "rejected"] as const;

export function canWorkerTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (to === "withdrawn") return (WORKER_OPEN as readonly string[]).includes(from);
  if (from === "offered" && (to === "accepted" || to === "declined")) return true;
  return false;
}

export function canEmployerTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return false;
  if (from === "offered") return to === "rejected";
  if (!(EMPLOYER_FROM as readonly string[]).includes(from)) return false;
  return (EMPLOYER_TO as readonly string[]).includes(to);
}

export function employerTargets(from: ApplicationStatus): ApplicationStatus[] {
  return EMPLOYER_TO.filter((status) => canEmployerTransition(from, status));
}

export function workerTargets(from: ApplicationStatus): ApplicationStatus[] {
  return (["withdrawn", "accepted", "declined"] as const).filter((status) => canWorkerTransition(from, status));
}
