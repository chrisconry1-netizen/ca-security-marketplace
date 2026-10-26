import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { fieldClass, StatusBadge } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { credentialTimeState } from "@/lib/workers/expiry";
import { PROFILE_MESSAGES } from "@/lib/workers/messages";
import { relationName } from "@/lib/workers/present";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { signOwnCredentialDocument } from "@/server/storage/signed-urls";
import { deleteCredential, saveCredential, submitCredential } from "../actions";

export default async function CredentialDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireArea("worker");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: row }, { data: types }, { data: reviews }, { data: notices }] = await Promise.all([
    supabase
      .from("credentials")
      .select("id, status, credential_number, issuer, issued_on, expires_on, document_path, credential_type_id, credential_types(name, has_expiration, issuing_authority)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("credential_types").select("id, name").eq("is_active", true).order("name"),
    supabase.from("credential_verifications").select("id, result_status, method, notes, verified_at").eq("credential_id", id).order("verified_at", { ascending: false }),
    supabase.from("notifications").select("id, title, body, created_at").contains("data", { credential_id: id }).order("created_at", { ascending: false }).limit(5),
  ]);
  if (!row) notFound();
  const editable = row.status === "unverified" || row.status === "rejected";
  const timeState = credentialTimeState(row.status, row.expires_on);
  const documentUrl = row.document_path ? await signOwnCredentialDocument(row.document_path, ctx.userId, row.id) : null;
  const typeName = relationName(row.credential_types as { name: string } | { name: string }[] | null);

  return (
    <AppShell ctx={ctx} title="Worker" nav={[{ href: "/worker/credentials", label: "Credentials", ready: true }, { href: "/worker/profile", label: "Profile", ready: true }]}>
      <Notice code={sp.notice} tone="info" messages={PROFILE_MESSAGES} />
      <Notice code={sp.error} messages={PROFILE_MESSAGES} />
      <p className="mt-2 text-sm text-slate-500">
        <Link href="/worker/credentials" className="underline">
          Credentials
        </Link>
      </p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{typeName}</h1>
        <StatusBadge status={row.status} timeState={timeState} />
      </div>
      <p className="mt-2 text-sm text-slate-600">Verification is a human decision. Submitting does not verify this credential, and this screen does not contact BSIS.</p>

      {(notices ?? []).length > 0 && (
        <ul className="mt-4 space-y-2">
          {(notices ?? []).map((note) => (
            <li key={note.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <span className="font-semibold">{note.title}</span>
              {note.body ? ` — ${note.body}` : ""}
            </li>
          ))}
        </ul>
      )}

      {documentUrl && (
        <p className="mt-4">
          <a href={documentUrl} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
            View document
          </a>
          <span className="block text-xs text-slate-500">Link expires in 60 seconds.</span>
        </p>
      )}

      {editable ? (
        <form action={saveCredential} className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <input type="hidden" name="credentialId" value={row.id} />
          <label className="block text-sm font-medium text-slate-800">
            Credential type
            <select defaultValue={row.credential_type_id} className={fieldClass} disabled aria-label="Credential type">
              {(types ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="credentialTypeId" value={row.credential_type_id} />
          <label className="block text-sm font-medium text-slate-800">
            Credential number
            <input name="credentialNumber" required maxLength={64} defaultValue={row.credential_number ?? ""} autoComplete="off" className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Issuer
            <input name="issuer" required maxLength={160} defaultValue={row.issuer ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Issued on
            <input name="issuedOn" type="date" required defaultValue={row.issued_on ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Expires on
            <input name="expiresOn" type="date" defaultValue={row.expires_on ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Replace document
            <input name="document" type="file" accept="application/pdf,image/jpeg,image/png,image/heic" className="mt-1 block w-full text-sm" />
          </label>
          <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
            Save credential
          </button>
        </form>
      ) : (
        <dl className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
          <div>
            <dt className="text-slate-500">Number</dt>
            <dd>{row.credential_number}</dd>
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
      )}

      {editable && (
        <form action={submitCredential} className="mt-3">
          <input type="hidden" name="credentialId" value={row.id} />
          <button type="submit" className="w-full rounded-lg border border-slate-900 px-4 py-3 text-base font-semibold text-slate-900">
            Submit for review
          </button>
        </form>
      )}
      {editable && (
        <form action={deleteCredential} className="mt-3">
          <input type="hidden" name="credentialId" value={row.id} />
          <button type="submit" className="w-full rounded-lg px-4 py-3 text-sm font-medium text-red-800">
            Delete credential
          </button>
        </form>
      )}

      {(reviews ?? []).length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold text-slate-900">Review history</h2>
          <ul className="mt-2 space-y-2">
            {(reviews ?? []).map((review) => (
              <li key={review.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                <span className="font-medium capitalize">{review.result_status}</span> · {review.method.replaceAll("_", " ")} · {new Date(review.verified_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}
                {review.notes && <p className="mt-1">{review.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
