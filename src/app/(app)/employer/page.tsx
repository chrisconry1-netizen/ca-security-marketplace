import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pill, verificationTone } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { ORG_COLUMNS, orgTypeLabel } from "@/lib/orgs/constants";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

function verificationLabel(status: string): string {
  if (status === "pending") return "Pending verification";
  if (status === "verified") return "Verified";
  if (status === "rejected") return "Rejected";
  if (status === "expired") return "Expired";
  return "Unverified";
}

export default async function EmployerDashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const supabase = await createClient();
  const ids = ctx.orgMemberships.map((membership) => membership.organization_id);
  const { data: orgs } = ids.length
    ? await supabase.from("organizations").select(ORG_COLUMNS).in("id", ids).order("name")
    : { data: [] };

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={EMPLOYER_MESSAGES} />
      <Notice code={queryValue(sp.error)} messages={EMPLOYER_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">I need security staff</h1>
      <p className="mt-1 text-sm text-slate-600">Your organization is the hiring party. GuardGig does not employ or dispatch workers.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/employer/org/edit" className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Create organization</Link>
        <Link href="/employer/jobs" className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900">Jobs &amp; shifts</Link>
      </div>
      <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {(orgs ?? []).length === 0 && <li className="p-4 text-sm text-slate-600">No organization yet. Create one, then a moderator records verification. Nothing is checked with BSIS automatically.</li>}
        {(orgs ?? []).map((org) => (
          <li key={org.id}>
            <Link href={`/employer/org?org=${org.id}`} className="flex items-center justify-between gap-3 p-4">
              <span>
                <span className="block font-medium text-slate-900">{org.name}</span>
                <span className="block text-sm text-slate-600">{orgTypeLabel(org.org_type)}</span>
              </span>
              <Pill label={verificationLabel(org.verification_status)} tone={verificationTone(org.verification_status === "pending" ? "pending_review" : org.verification_status)} />
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
