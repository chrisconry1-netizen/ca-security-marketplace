import { AppShell, PlaceholderCard } from "@/components/app-shell";
import { requireArea } from "@/server/auth/guards";

export default async function EmployerDashboard() {
  const ctx = await requireArea("employer");
  return (
    <AppShell ctx={ctx} title="Employer" nav={[{ href: "/employer/org", label: "Organization" }, { href: "/employer/jobs", label: "Jobs & shifts" }, { href: "/employer/applicants", label: "Applicants" }, { href: "/employer/workers", label: "Find workers" }, { href: "/employer/messages", label: "Messages" }]}>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">I need security staff</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlaceholderCard title="Set up your organization" body={ctx.orgMemberships.length ? `Member of ${ctx.orgMemberships.length} organization(s).` : "Organization creation and verification arrive in a later phase."} />
        <PlaceholderCard title="Post a shift" body="Job and shift posting arrive in a later phase." />
      </div>
    </AppShell>
  );
}
