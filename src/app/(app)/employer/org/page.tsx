import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pill, verificationTone } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { licenseRequired, ORG_COLUMNS, orgRoleLabel, orgTypeLabel } from "@/lib/orgs/constants";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { signOrgLogo } from "@/server/storage/signed-urls";
import { submitOrganizationVerification } from "./actions";

function verificationLabel(status: string): string {
  if (status === "pending") return "Pending verification";
  if (status === "verified") return "Verified";
  if (status === "rejected") return "Rejected";
  if (status === "expired") return "Expired";
  return "Unverified";
}

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const requested = queryValue(sp.org);
  const orgId = ctx.orgMemberships.some((membership) => membership.organization_id === requested)
    ? requested
    : ctx.orgMemberships[0]?.organization_id ?? "";
  const membership = ctx.orgMemberships.find((item) => item.organization_id === orgId);
  const supabase = await createClient();
  const { data: org } = orgId
    ? await supabase.from("organizations").select(ORG_COLUMNS).eq("id", orgId).maybeSingle()
    : { data: null };
  const license = org && membership
    ? (await supabase.rpc("organization_license", { p_org: org.id })).data?.[0]
    : null;
  const logo = org ? await signOrgLogo(org.logo_path, org.id) : null;
  const canSubmit = membership?.role === "owner_admin" && org && ["unverified", "rejected", "expired"].includes(org.verification_status);

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={EMPLOYER_MESSAGES} />
      <Notice code={queryValue(sp.error)} messages={EMPLOYER_MESSAGES} />
      {!org && (
        <>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Organization</h1>
          <p className="mt-2 text-sm text-slate-600">Create an organization before posting jobs.</p>
          <Link href="/employer/org/edit" className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Create organization</Link>
        </>
      )}
      {org && (
        <>
          <div className="mt-2 flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{org.name}</h1>
            {membership?.role === "owner_admin" && (
              <Link href={`/employer/org/edit?org=${org.id}`} className="shrink-0 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Edit organization</Link>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill label={verificationLabel(org.verification_status)} tone={verificationTone(org.verification_status === "pending" ? "pending_review" : org.verification_status)} />
            <span className="text-sm text-slate-600">{membership ? orgRoleLabel(membership.role) : "Not a member"}</span>
          </div>
          <p className="mt-3 text-sm text-slate-600">A moderator records verification. GuardGig does not check the license with BSIS, and verifying the organization does not publish jobs by itself.</p>
          <section className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
            {logo && (
              // Signed URL from the private org-logos bucket.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-16 w-16 rounded-lg object-cover" />
            )}
            <p><span className="font-medium text-slate-500">Type. </span>{orgTypeLabel(org.org_type)}</p>
            <p><span className="font-medium text-slate-500">Website. </span>{org.website || "Not set"}</p>
            <p><span className="font-medium text-slate-500">Contact email. </span>{org.contact_email || "Not set"}</p>
            <p><span className="font-medium text-slate-500">Contact phone. </span>{org.contact_phone_e164 || "Not set"}</p>
            <p><span className="font-medium text-slate-500">Service counties. </span>{(org.service_counties ?? []).join(", ") || "Not set"}</p>
            <p className="whitespace-pre-wrap">{org.description || "No description yet."}</p>
            <div>
              <p className="font-medium text-slate-500">License number</p>
              <p>{license?.license_number || "Not provided"}</p>
              {license?.license_type && <p className="text-slate-600">{license.license_type}</p>}
              <p className="text-xs text-slate-500">Shown as submitted. This is not a verification.</p>
            </div>
          </section>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/employer/team?org=${org.id}`} className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900">Team</Link>
            <Link href={`/employer/jobs?org=${org.id}`} className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900">Jobs</Link>
          </div>
          {canSubmit && (
            <form action={submitOrganizationVerification} className="mt-4">
              <input type="hidden" name="organizationId" value={org.id} />
              <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Submit for verification</button>
              {licenseRequired(org.org_type) && !license?.license_number && (
                <p className="mt-2 text-sm text-slate-600">Add a license number before submitting.</p>
              )}
            </form>
          )}
        </>
      )}
    </AppShell>
  );
}
