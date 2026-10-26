import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { credentialTimeState } from "@/lib/workers/expiry";
import { PROFILE_MESSAGES } from "@/lib/workers/messages";
import { relationName } from "@/lib/workers/present";
import { maskCredentialNumber } from "@/lib/workers/validation";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function VerificationQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("admin");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("credentials")
    .select("id, worker_id, status, issuer, credential_number, issued_on, expires_on, created_at, credential_types(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const workerIds = [...new Set((rows ?? []).map((row) => row.worker_id))];
  const { data: people } = workerIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", workerIds)
    : { data: [] };
  const names = new Map((people ?? []).map((person) => [person.id, person.display_name]));

  return (
    <AppShell ctx={ctx} title="Admin" nav={[{ href: "/admin", label: "Home", ready: true }, { href: "/admin/verification", label: "Verification", ready: true }, { href: "/admin/reports", label: "Reports" }]}>
      <Notice code={sp.notice} tone="info" messages={PROFILE_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Credential review</h1>
      <p className="mt-1 text-sm text-slate-600">Pending credentials only. A person records the decision. This queue does not query BSIS or any other registry, and it does not verify anything on its own.</p>
      <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {(rows ?? []).length === 0 && <li className="p-4 text-sm text-slate-600">Nothing is waiting for review.</li>}
        {(rows ?? []).map((row) => (
          <li key={row.id}>
            <Link href={`/admin/verification/${row.id}`} className="flex items-center justify-between gap-3 p-4">
              <span>
                <span className="block font-medium text-slate-900">{names.get(row.worker_id) ?? "Worker"}</span>
                <span className="block text-sm text-slate-700">{relationName(row.credential_types as { name: string } | { name: string }[] | null)}</span>
                <span className="block text-xs text-slate-500">{row.issuer || "No issuer"} · {maskCredentialNumber(row.credential_number)}</span>
              </span>
              <StatusBadge status={row.status} timeState={credentialTimeState(row.status, row.expires_on)} />
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
