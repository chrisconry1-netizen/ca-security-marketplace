import Link from "next/link";
import { AppShell, PlaceholderCard } from "@/components/app-shell";
import { adminNav } from "@/lib/employer/nav";
import { requireArea } from "@/server/auth/guards";
import { hasAnyRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export default async function AdminDashboard() {
  const ctx = await requireArea("admin");
  const canReadAudit = hasAnyRole(ctx.roles, ["admin", "super_admin"]);
  // RLS also restricts audit_logs to admin/super_admin; the role check only avoids a pointless query.
  const { data: events } = canReadAudit
    ? await (await createClient()).from("audit_logs").select("id, occurred_at, actor_type, action, entity_type").order("occurred_at", { ascending: false }).limit(20)
    : { data: null };
  return (
    <AppShell ctx={ctx} title="Admin" nav={adminNav}>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Trust &amp; operations</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Credential review</h2>
          <p className="mt-1 text-sm text-slate-600">Pending worker credentials are in the verification queue. Decisions are human. Nothing is verified automatically.</p>
          <Link href="/admin/verification" className="mt-3 inline-block text-sm font-semibold text-slate-900 underline">Open credential queue</Link>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">Organization review</h2>
          <p className="mt-1 text-sm text-slate-600">Pending organizations wait for a person to record a decision. The license number is not checked with BSIS, and approval does not publish jobs.</p>
          <Link href="/admin/organizations" className="mt-3 inline-block text-sm font-semibold text-slate-900 underline">Open organization queue</Link>
        </section>
        <PlaceholderCard title="Reports & moderation" body="The rest of the admin center arrives in a later phase." />
      </div>
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Recent audit events</h2>
        {!canReadAudit && <p className="mt-1 text-sm text-slate-600">Audit log is limited to admins.</p>}
        {canReadAudit && (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {(events ?? []).map((e) => (
              <li key={e.id} className="py-2 text-slate-700">
                <span className="font-mono text-xs text-slate-500">{new Date(e.occurred_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}</span>{" "}
                {e.action} · {e.actor_type} · {e.entity_type}
              </li>
            ))}
            {(events ?? []).length === 0 && <li className="py-2 text-slate-500">No events.</li>}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
