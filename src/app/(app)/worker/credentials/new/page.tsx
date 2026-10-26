import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fieldClass } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { PROFILE_MESSAGES } from "@/lib/workers/messages";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { saveCredential } from "../actions";

export default async function NewCredentialPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("worker");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: types } = await supabase.from("credential_types").select("id, name, issuing_authority, has_expiration").eq("is_active", true).order("name");

  return (
    <AppShell ctx={ctx} title="Worker" nav={[{ href: "/worker/credentials", label: "Credentials", ready: true }, { href: "/worker/profile", label: "Profile", ready: true }]}>
      <Notice code={sp.error} messages={PROFILE_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Add credential</h1>
      <p className="mt-1 text-sm text-slate-600">Saving keeps it unverified. Submit it from the next screen when the document is attached. Numbers stay private.</p>
      <form action={saveCredential} className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-800">
          Credential type
          <select name="credentialTypeId" required className={fieldClass} defaultValue="">
            <option value="" disabled>
              Choose a type
            </option>
            {(types ?? []).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Credential number
          <input name="credentialNumber" maxLength={64} autoComplete="off" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Issuer
          <input name="issuer" maxLength={160} placeholder="CA BSIS, American Red Cross, …" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Issued on
          <input name="issuedOn" type="date" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Expires on
          <input name="expiresOn" type="date" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Credential document
          <input name="document" type="file" accept="application/pdf,image/jpeg,image/png,image/heic" className="mt-1 block w-full text-sm" />
        </label>
        <p className="text-xs text-slate-500">PDF, JPG, PNG, or HEIC. 10 MB max. Private bucket. You cannot delete the file later from this app.</p>
        <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
          Save credential
        </button>
        <Link href="/worker/credentials" className="block text-center text-sm text-slate-700 underline">
          Cancel
        </Link>
      </form>
    </AppShell>
  );
}
