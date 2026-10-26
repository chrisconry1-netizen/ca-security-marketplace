import { AppShell, PlaceholderCard } from "@/components/app-shell";
import { requireArea } from "@/server/auth/guards";

export default async function WorkerDashboard() {
  const ctx = await requireArea("worker");
  return (
    <AppShell ctx={ctx} title="Worker" nav={[{ href: "/worker/shifts", label: "Find shifts" }, { href: "/worker/applications", label: "Applications" }, { href: "/worker/credentials", label: "Credentials" }, { href: "/worker/availability", label: "Availability" }, { href: "/worker/messages", label: "Messages" }]}>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">I need security work</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlaceholderCard title="Complete your profile" body="Profile, credentials and availability arrive in Phase 2." />
        <PlaceholderCard title="Matching shifts" body="Shift discovery and AI matching arrive in later phases." />
      </div>
    </AppShell>
  );
}
