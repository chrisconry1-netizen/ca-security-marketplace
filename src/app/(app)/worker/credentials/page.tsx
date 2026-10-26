import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { credentialTimeState } from "@/lib/workers/expiry";
import { PROFILE_MESSAGES } from "@/lib/workers/messages";
import { relationName } from "@/lib/workers/present";
import { maskCredentialNumber } from "@/lib/workers/validation";
import { workerNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function CredentialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("worker");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("credentials")
    .select("id, status, credential_number, issuer, expires_on, credential_types(name)")
    .order("created_at", { ascending: false });

  return (
    <AppShell ctx={ctx} title="Worker" nav={workerNav}>
      <Notice code={sp.notice} tone="info" messages={PROFILE_MESSAGES} />
      <Notice code={sp.error} messages={PROFILE_MESSAGES} />
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Credentials</h1>
        <Link href="/worker/credentials/new" className="shrink-0 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
          Add credential
        </Link>
      </div>
      <p className="mt-2 text-sm text-slate-600">You can submit a credential for review. You cannot mark it verified. A moderator does that after looking at the document. This app does not look up BSIS.</p>
      <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {(rows ?? []).length === 0 && <li className="p-4 text-sm text-slate-600">No credentials yet.</li>}
        {(rows ?? []).map((row) => (
          <li key={row.id}>
            <Link href={`/worker/credentials/${row.id}`} className="flex items-center justify-between gap-3 p-4">
              <span>
                <span className="block font-medium text-slate-900">{relationName(row.credential_types as { name: string } | { name: string }[] | null)}</span>
                <span className="block text-xs text-slate-500">{row.issuer || "Issuer not set"} · {maskCredentialNumber(row.credential_number)}</span>
              </span>
              <StatusBadge status={row.status} timeState={credentialTimeState(row.status, row.expires_on)} />
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
