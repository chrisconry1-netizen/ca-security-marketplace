import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { JobDraftForm, type JobFormDefaults } from "@/components/jobs/job-form";
import { Notice } from "@/components/ui";
import { JOB_MESSAGES } from "@/lib/jobs/messages";
import { employerNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

const empty: Omit<JobFormDefaults, "organizationId"> = {
  title: "",
  description: "",
  jobType: "single_shift",
  category: "unarmed_security",
  armed: "no",
  urgency: "normal",
  city: "",
  county: "",
  postalCode: "",
  siteAddress: "",
  siteLat: "",
  siteLng: "",
  approxLat: "",
  approxLng: "",
  startsLocal: "",
  endsLocal: "",
  payType: "hourly",
  payMin: "",
  payMax: "",
  workersNeeded: "1",
  minYears: "",
  uniformNotes: "",
  vehicleRequired: false,
  equipmentNotes: "",
  deadlineLocal: "",
  requiredCodes: [],
  optionalCodes: [],
};

export default async function NewJobPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const ids = ctx.orgMemberships.map((membership) => membership.organization_id);
  if (!ids.length) redirect("/employer/org");
  const supabase = await createClient();
  const [{ data: orgs }, { data: types }] = await Promise.all([
    supabase.from("organizations").select("id, name").in("id", ids),
    supabase.from("credential_types").select("code, name").eq("is_active", true).order("name"),
  ]);
  const organizations = orgs ?? [];
  if (!organizations.length) redirect("/employer/org");

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={sp.error} messages={JOB_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Post a shift</h1>
      <div className="mt-4">
        <JobDraftForm organizations={organizations} types={types ?? []} defaults={{ ...empty, organizationId: organizations[0].id }} />
      </div>
    </AppShell>
  );
}
