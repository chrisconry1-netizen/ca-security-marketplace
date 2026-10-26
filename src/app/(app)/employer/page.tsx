import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { employerNav } from "@/lib/nav";
import { requireArea } from "@/server/auth/guards";

export default async function EmployerDashboard() {
  const ctx = await requireArea("employer");
  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">I need security staff</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link href="/employer/org" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-900">
          <h2 className="font-semibold text-slate-900">Organization</h2>
          <p className="mt-1 text-sm text-slate-600">
            {ctx.orgMemberships.length
              ? `Member of ${ctx.orgMemberships.length} organization(s). Verification is a separate staff decision.`
              : "Create the organization that will employ the worker. It stays unverified until a person reviews it."}
          </p>
        </Link>
        <Link href="/employer/jobs" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-900">
          <h2 className="font-semibold text-slate-900">Jobs and shifts</h2>
          <p className="mt-1 text-sm text-slate-600">Post a shift, review applicants, and offer work. This marketplace does not employ the worker or set the wage.</p>
        </Link>
      </div>
    </AppShell>
  );
}
