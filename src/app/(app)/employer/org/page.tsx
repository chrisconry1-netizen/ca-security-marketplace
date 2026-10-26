import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fieldClass } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { ORG_TYPES } from "@/lib/jobs/constants";
import { JOB_MESSAGES } from "@/lib/jobs/messages";
import { employerNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { createOrganization } from "./actions";

export default async function EmployerOrgPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const ids = ctx.orgMemberships.map((membership) => membership.organization_id);
  const supabase = await createClient();
  const { data: orgs } = ids.length
    ? await supabase.from("organizations").select("id, name, org_type, verification_status, description").in("id", ids)
    : { data: [] };

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={sp.notice} tone="info" messages={JOB_MESSAGES} />
      <Notice code={sp.error} messages={JOB_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Organization</h1>
      <p className="mt-1 text-sm text-slate-600">The organization is the employer. A new organization stays unverified until a person reviews it. Unverified organizations can save drafts, and publishing keeps those shifts in review.</p>
      <div className="mt-4 space-y-3">
        {(orgs ?? []).map((org) => (
          <article key={org.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold text-slate-900">{org.name}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {ORG_TYPES.find((item) => item.code === org.org_type)?.label ?? org.org_type}
              {" · "}
              {org.verification_status === "verified" ? "Verified organization" : "Not verified"}
            </p>
            {org.description && <p className="mt-2 text-sm text-slate-700">{org.description}</p>}
          </article>
        ))}
      </div>
      <form action={createOrganization} className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold text-slate-900">Create organization</h2>
        <label className="block text-sm font-medium text-slate-800">
          Organization name
          <input name="name" required maxLength={200} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Organization type
          <select name="orgType" defaultValue="ppo" className={fieldClass}>
            {ORG_TYPES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Description
          <textarea name="description" maxLength={5000} className={`${fieldClass} min-h-24`} />
        </label>
        <button type="submit" className="min-h-11 w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
          Create organization
        </button>
      </form>
      <Link href="/employer/jobs" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-slate-900 underline">
        Jobs and shifts
      </Link>
    </AppShell>
  );
}
