import Link from "next/link";
import { JobFilters } from "@/components/jobs/filters";
import { JobCard } from "@/components/jobs/job-card";
import { Notice } from "@/components/ui";
import { JOB_MESSAGES } from "@/lib/jobs/messages";
import { LOCATION_DISCLAIMER, PAGE_SIZE } from "@/lib/jobs/constants";
import { searchQuery, type JobSearchInput } from "@/lib/jobs/search-params";
import type { MarketplaceJob } from "@/server/jobs/search";

export function JobResults({
  action,
  input,
  rows,
  total,
  credentials,
  showEligible,
  notice,
  originLabel,
  errorCode,
}: {
  action: string;
  input: JobSearchInput;
  rows: MarketplaceJob[];
  total: number;
  credentials: { code: string; name: string }[];
  showEligible: boolean;
  notice: string | null;
  originLabel: string | null;
  errorCode?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">What&apos;s available for me to work?</h1>
        <p className="mt-1 text-sm text-slate-600">Soonest shifts first. Urgent posts stay at the top. {LOCATION_DISCLAIMER}</p>
      </div>
      <Notice code={errorCode} messages={JOB_MESSAGES} />
      <Notice code={notice ?? undefined} tone="info" messages={JOB_MESSAGES} />
      <JobFilters action={action} input={input} credentials={credentials} showEligible={showEligible} />
      {originLabel && <p className="text-sm text-slate-600">Distance is from {originLabel}.</p>}
      <p className="text-sm font-medium text-slate-700">{total === 0 ? "No published shifts match these filters." : `${total} published shift${total === 1 ? "" : "s"}`}</p>
      <div className="space-y-3">
        {rows.map((job) => (
          <JobCard key={job.id} job={job} href={`/jobs/${job.id}`} />
        ))}
      </div>
      {pages > 1 && (
        <div className="flex gap-2">
          {input.page > 1 && (
            <Link href={`${action}${searchQuery(input, { page: input.page - 1 })}`} className="min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900">
              Previous
            </Link>
          )}
          {input.page < pages && (
            <Link href={`${action}${searchQuery(input, { page: input.page + 1 })}`} className="min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900">
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
