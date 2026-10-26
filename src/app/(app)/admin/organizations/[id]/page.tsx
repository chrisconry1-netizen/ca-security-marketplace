import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fieldClass, Pill, verificationTone } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { adminNav } from "@/lib/employer/nav";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { queryValue } from "@/lib/form";
import { ORG_COLUMNS, orgTypeLabel } from "@/lib/orgs/constants";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { reviewOrganization } from "../actions";

function verificationLabel(status: string): string {
  if (status === "pending") return "Pending verification";
  if (status === "verified") return "Verified";
  if (status === "rejected") return "Rejected";
  if (status === "expired") return "Expired";
  return "Unverified";
}

export default async function OrganizationReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireArea("admin");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select(ORG_COLUMNS).eq("id", id).maybeSingle();
  const license = org ? (await supabase.rpc("organization_license", { p_org: org.id })).data?.[0] : null;

  return (
    <AppShell ctx={ctx} title="Admin" nav={adminNav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={EMPLOYER_MESSAGES} />
      <Notice code={queryValue(sp.error)} messages={EMPLOYER_MESSAGES} />
      <Link href="/admin/organizations" className="text-sm font-medium text-slate-700 underline">Back to organizations</Link>
      {!org && <h1 className="mt-2 text-2xl font-bold text-slate-900">Organization unavailable</h1>}
      {org && (
        <>
          <div className="mt-2 flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{org.name}</h1>
            <Pill label={verificationLabel(org.verification_status)} tone={verificationTone(org.verification_status === "pending" ? "pending_review" : org.verification_status)} />
          </div>
          <section className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
            <p>{orgTypeLabel(org.org_type)}</p>
            <p>Contact: {org.contact_email || "No email"} {org.contact_phone_e164 ? `· ${org.contact_phone_e164}` : ""}</p>
            <p>Website: {org.website || "Not set"}</p>
            <p>Counties: {(org.service_counties ?? []).join(", ") || "Not set"}</p>
            <p className="whitespace-pre-wrap">{org.description || "No description."}</p>
            <div>
              <p className="font-medium text-slate-500">License number, as submitted</p>
              <p>{license?.license_number || "Not provided"}</p>
              {license?.license_type && <p>{license.license_type}</p>}
              <p className="text-xs text-slate-500">Recording a decision does not check this number with BSIS.</p>
            </div>
          </section>
          {org.verification_status === "pending" && (
            <form action={reviewOrganization} className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <input type="hidden" name="organizationId" value={org.id} />
              <label className="block text-sm font-medium text-slate-800">
                Notes
                <textarea name="notes" required minLength={8} maxLength={4000} rows={4} className={fieldClass} />
              </label>
              <p className="text-xs text-slate-500">You cannot review an organization you belong to. A note is required. This does not publish the organization&apos;s jobs.</p>
              <button type="submit" name="decision" value="verified" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Verify organization</button>
              <button type="submit" name="decision" value="rejected" className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900">Reject organization</button>
            </form>
          )}
        </>
      )}
    </AppShell>
  );
}
