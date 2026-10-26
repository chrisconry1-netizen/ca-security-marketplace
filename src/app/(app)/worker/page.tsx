import Link from "next/link";
import { AppShell, PlaceholderCard } from "@/components/app-shell";
import { workerNav } from "@/lib/nav";
import { requireArea } from "@/server/auth/guards";

export default async function WorkerDashboard() {
  const ctx = await requireArea("worker");
  return (
    <AppShell ctx={ctx} title="Worker" nav={workerNav}>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">I need security work</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlaceholderCard title="Complete your profile" body="Add your work area, experience, credentials, and availability. Credentials stay unverified until a person reviews them." />
        <Link href="/worker/shifts" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-900">
          <h2 className="font-semibold text-slate-900">What&apos;s available for me to work?</h2>
          <p className="mt-1 text-sm text-slate-600">Search published shifts by city, pay, time, and the credentials a person has already verified.</p>
        </Link>
      </div>
    </AppShell>
  );
}
