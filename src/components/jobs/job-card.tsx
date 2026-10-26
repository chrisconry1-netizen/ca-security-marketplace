import Link from "next/link";
import { categoryLabel, formatDistance, formatJobPay, formatShiftWhen, jobTypeLabel } from "@/lib/jobs/present";
import type { MarketplaceJob } from "@/server/jobs/search";

export function JobCard({ job, href }: { job: MarketplaceJob; href: string }) {
  const distance = formatDistance(job.distance_miles);
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            <Link href={href} className="underline-offset-2 hover:underline">
              {job.title}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-slate-600">{[job.city, job.county].filter(Boolean).join(" · ") || "California"}</p>
        </div>
        {job.urgency === "urgent" && <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-900">Urgent</span>}
        {job.urgency === "priority" && <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-950">Priority</span>}
      </div>
      <p className="mt-3 text-base font-semibold text-slate-900">{formatJobPay(job.pay_type, job.pay_min_cents, job.pay_max_cents)}</p>
      <p className="mt-1 text-sm text-slate-700">{formatShiftWhen(job.starts_at, job.ends_at, job.shift_period)}</p>
      <p className="mt-2 text-sm text-slate-600">
        {categoryLabel(job.category)} · {job.is_armed ? "Armed" : "Unarmed"} · {jobTypeLabel(job.job_type)}
        {distance ? ` · ${distance}` : ""}
      </p>
      <p className="mt-2 text-sm text-slate-800">
        {job.employer_name ?? "Employer"}
        {job.employer_verified && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900">Verified employer</span>}
      </p>
      {job.summary && <p className="mt-2 line-clamp-3 text-sm text-slate-600">{job.summary}</p>}
      <Link href={href} className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
        View shift
      </Link>
    </article>
  );
}
