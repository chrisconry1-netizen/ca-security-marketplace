import { AppShell, PlaceholderCard } from "@/components/app-shell";
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
    <AppShell ctx={ctx} title="Admin" nav={[{ href: "/admin/verification", label: "Verification" }, { href: "/admin/reports", label: "Reports" }, { href: "/admin/users", label: "Users" }, { href: "/admin/audit", label: "Audit" }]}>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Trust &amp; operations</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlaceholderCard title="Verification queues" body="Worker/employer/credential review arrives in later phases. No automated rejections." />
        <PlaceholderCard title="Reports & moderation" body="Arrives in Phase 12." />
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
