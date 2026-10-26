import Link from "next/link";
import { OrgForm } from "@/components/org-form";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/ui";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { ORG_COLUMNS } from "@/lib/orgs/constants";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { saveOrganization } from "../actions";

export default async function EditOrganizationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const orgId = queryValue(sp.org);
  if (orgId && !ctx.orgMemberships.some((membership) => membership.organization_id === orgId && membership.role === "owner_admin")) {
    return (
      <AppShell ctx={ctx} title="Employer" nav={employerNav}>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Organization</h1>
        <p className="mt-2 text-sm text-slate-600">Only an Owner/Admin can edit this organization.</p>
      </AppShell>
    );
  }
  const supabase = await createClient();
  const { data: org } = orgId
    ? await supabase.from("organizations").select(ORG_COLUMNS).eq("id", orgId).maybeSingle()
    : { data: null };
  const license = org ? (await supabase.rpc("organization_license", { p_org: org.id })).data?.[0] : null;

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.error)} messages={EMPLOYER_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">{org ? "Edit organization" : "Create organization"}</h1>
      <p className="mt-1 text-sm text-slate-600">Changing the organization type or license while a review is pending, or after verification, returns the organization to unverified.</p>
      {org && <Link href={`/employer/org?org=${org.id}`} className="mt-2 inline-block text-sm font-medium text-slate-700 underline">Back to organization</Link>}
      <OrgForm
        action={saveOrganization}
        organizationId={org?.id}
        defaults={org ? {
          name: org.name,
          orgType: org.org_type,
          website: org.website ?? "",
          contactEmail: org.contact_email ?? "",
          contactPhone: org.contact_phone_e164 ?? "",
          description: org.description ?? "",
          serviceCounties: (org.service_counties ?? []).join("\n"),
          licenseType: license?.license_type ?? "",
          licenseNumber: license?.license_number ?? "",
          logoPath: org.logo_path,
        } : undefined}
      />
    </AppShell>
  );
}
