import { AppShell, PlaceholderCard } from "@/components/app-shell";
import { requireArea } from "@/server/auth/guards";

export default async function WorkerDashboard() {
  const ctx = await requireArea("worker");
  return (
    <AppShell ctx={ctx} title="Worker" nav={[{ href: "/worker/profile", label: "Profile", ready: true }, { href: "/worker/shifts", label: "Find shifts" }, { href: "/worker/credentials", label: "Credentials", ready: true }, { href: "/worker/availability", label: "Availability", ready: true }, { href: "/worker/messages", label: "Messages" }]}>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">I need security work</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlaceholderCard title="Complete your profile" body="Add your work area, experience, credentials, and availability. Credentials stay unverified until a person reviews them." />
        <PlaceholderCard title="Matching shifts" body="Shift discovery and AI matching arrive in later phases." />
      </div>
    </AppShell>
  );
}
