/** Mirrors app.job_transition_ok and public.transition_job. SQL is the enforcement. */
export const JOB_STATUSES = [
  "draft",
  "pending_review",
  "published",
  "filled",
  "in_progress",
  "completed",
  "cancelled",
  "expired",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

const EDGES: Record<JobStatus, readonly JobStatus[]> = {
  draft: ["pending_review", "published", "cancelled"],
  pending_review: ["draft", "published", "cancelled"],
  published: ["filled", "in_progress", "cancelled", "expired"],
  filled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  expired: [],
};

/**
 * Publish rule: a request to publish while the organization is not verified
 * moves a draft to pending_review and leaves an existing pending_review job there.
 * The database rejects a real published row unless the organization is verified.
 */
export function transitionJob(from: JobStatus, requested: JobStatus, orgVerified: boolean): JobStatus | null {
  if (requested === "published" && !orgVerified) {
    if (from === "draft" || from === "pending_review") return "pending_review";
    return null;
  }
  if (from === requested) return from;
  if (!(EDGES[from] ?? []).includes(requested)) return null;
  if (requested === "published" && !orgVerified) return null;
  return requested;
}

export function allowedTargets(from: JobStatus, orgVerified: boolean): JobStatus[] {
  const raw = EDGES[from] ?? [];
  const targets = new Set<JobStatus>();
  for (const requested of raw) {
    const next = transitionJob(from, requested, orgVerified);
    if (next && next !== from) targets.add(next);
  }
  return JOB_STATUSES.filter((status) => targets.has(status));
}

export function jobStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "pending_review":
      return "Pending review";
    case "published":
      return "Published";
    case "filled":
      return "Filled";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}
