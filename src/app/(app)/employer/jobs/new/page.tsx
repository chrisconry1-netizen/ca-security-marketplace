import Link from "next/link";
import { redirect } from "next/navigation";
import { JobForm } from "@/components/job-form";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/ui";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { saveJob } from "../actions";

export default async function NewJobPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const orgId = queryValue(sp.org) || ctx.orgMemberships[0]?.organization_id || "";
  if (!orgId || !ctx.orgMemberships.some((membership) => membership.organization_id === orgId)) redirect("/employer/jobs");
  const supabase = await createClient();
  const { data: types } = await supabase.from("credential_types").select("id, name").eq("is_active", true).order("name");

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.error)} messages={EMPLOYER_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">New job</h1>
      <Link href={`/employer/jobs?org=${orgId}`} className="mt-2 inline-block text-sm font-medium text-slate-700 underline">Back to jobs</Link>
      <JobForm action={saveJob} organizationId={orgId} credentialTypes={types ?? []} />
    </AppShell>
  );
}
