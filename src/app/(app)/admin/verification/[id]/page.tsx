import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { fieldClass, StatusBadge } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { credentialTimeState } from "@/lib/workers/expiry";
import { PROFILE_MESSAGES } from "@/lib/workers/messages";
import { relationName } from "@/lib/workers/present";
import { VERIFICATION_METHODS } from "@/lib/workers/categories";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { signCredentialDocumentForReview } from "@/server/storage/signed-urls";
import { reviewCredential } from "../actions";

export default async function ReviewCredentialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireArea("admin");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("credentials")
    .select("id, worker_id, status, credential_number, issuer, issued_on, expires_on, document_path, credential_types(name)")
    .eq("id", id)
    .maybeSingle();
  if (!row) notFound();
  const { data: person } = await supabase.from("profiles").select("display_name").eq("id", row.worker_id).maybeSingle();
  const documentUrl = row.status === "pending" ? await signCredentialDocumentForReview(row.id) : null;
  const timeState = credentialTimeState(row.status, row.expires_on);

  return (
    <AppShell ctx={ctx} title="Admin" nav={[{ href: "/admin/verification", label: "Verification", ready: true }, { href: "/admin", label: "Home", ready: true }]}>
      <Notice code={sp.notice} tone="info" messages={PROFILE_MESSAGES} />
      <Notice code={sp.error} messages={PROFILE_MESSAGES} />
      <p className="mt-2 text-sm">
        <Link href="/admin/verification" className="text-slate-700 underline">
          Queue
        </Link>
      </p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{relationName(row.credential_types as { name: string } | { name: string }[] | null)}</h1>
        <StatusBadge status={row.status} timeState={timeState} />
      </div>
      <p className="mt-1 text-sm text-slate-600">{person?.display_name ?? "Worker"}</p>
      <dl className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
        <div>
          <dt className="text-slate-500">Number</dt>
          <dd>{row.credential_number || "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Issuer</dt>
          <dd>{row.issuer || "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Issued</dt>
          <dd>{row.issued_on || "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Expires</dt>
          <dd>{row.expires_on || "—"}</dd>
        </div>
      </dl>
      {documentUrl ? (
        <p className="mt-3 text-sm">
          <a href={documentUrl} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
            Open document
          </a>
          <span className="block text-xs text-slate-500">Signed link, 60 seconds. Opening this page is audit-logged.</span>
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-600">{row.document_path ? "The document link is available while the credential is pending." : "No document was uploaded."}</p>
      )}

      {row.status === "pending" && (
        <form action={reviewCredential} className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <input type="hidden" name="credentialId" value={row.id} />
          <p className="text-sm text-slate-600">No automatic verification. Record the check you actually performed. Choosing “BSIS public lookup” does not contact BSIS.</p>
          <label className="block text-sm font-medium text-slate-800">
            Method
            <select name="method" className={fieldClass} defaultValue="document_review">
              {VERIFICATION_METHODS.map((method) => (
                <option key={method.code} value={method.code}>
                  {method.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Source reference
            <input name="sourceReference" maxLength={500} className={fieldClass} placeholder="Lookup reference or document description" />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Notes
            <textarea name="notes" maxLength={4000} rows={3} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Valid until
            <input name="validUntil" type="date" className={fieldClass} />
          </label>
          <button type="submit" name="decision" value="verified" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
            Verify credential
          </button>
          <button type="submit" name="decision" value="rejected" className="w-full rounded-lg border border-slate-900 px-4 py-3 text-base font-semibold text-slate-900">
            Reject credential
          </button>
        </form>
      )}
    </AppShell>
  );
}
