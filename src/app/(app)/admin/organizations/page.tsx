import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pill, verificationTone } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { adminNav } from "@/lib/employer/nav";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { queryValue } from "@/lib/form";
import { ORG_COLUMNS, orgTypeLabel } from "@/lib/orgs/constants";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function OrganizationsQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("admin");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("organizations")
    .select(ORG_COLUMNS)
    .eq("verification_status", "pending")
    .order("created_at", { ascending: true });

  return (
    <AppShell ctx={ctx} title="Admin" nav={adminNav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={EMPLOYER_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Organization review</h1>
      <p className="mt-1 text-sm text-slate-600">Pending organizations only. A person records the decision. This queue does not query BSIS, and verifying an organization does not publish its jobs.</p>
      <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {(rows ?? []).length === 0 && <li className="p-4 text-sm text-slate-600">Nothing is waiting for review.</li>}
        {(rows ?? []).map((org) => (
          <li key={org.id}>
            <Link href={`/admin/organizations/${org.id}`} className="flex items-center justify-between gap-3 p-4">
              <span>
                <span className="block font-medium text-slate-900">{org.name}</span>
                <span className="block text-sm text-slate-600">{orgTypeLabel(org.org_type)}</span>
              </span>
              <Pill label="Pending verification" tone={verificationTone("pending_review")} />
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
