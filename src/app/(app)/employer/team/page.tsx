import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fieldClass } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { ORG_MEMBER_ROLES, orgRoleLabel } from "@/lib/orgs/constants";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { changeMemberRole, inviteMember, removeMember, revokeInvite } from "./actions";

interface RosterRow {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const requested = queryValue(sp.org);
  const orgId = ctx.orgMemberships.some((membership) => membership.organization_id === requested)
    ? requested
    : ctx.orgMemberships[0]?.organization_id ?? "";
  const membership = ctx.orgMemberships.find((item) => item.organization_id === orgId);
  const isOwner = membership?.role === "owner_admin";
  const token = queryValue(sp.token);
  const supabase = await createClient();
  const roster = orgId ? ((await supabase.rpc("organization_roster", { p_org: orgId })).data ?? []) as RosterRow[] : [];
  const { data: invites } = orgId && isOwner
    ? await supabase
      .from("organization_invites")
      .select("id, email, role, expires_at")
      .eq("organization_id", orgId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={EMPLOYER_MESSAGES} />
      <Notice code={queryValue(sp.error)} messages={EMPLOYER_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Team</h1>
      {!orgId && <p className="mt-2 text-sm text-slate-600">Create an organization before inviting anyone.</p>}
      {orgId && (
        <>
          <p className="mt-1 text-sm text-slate-600">Invites stay in the app. No email is sent. The accept link is shown once.</p>
          {token && (
            <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">Accept link, shown once</p>
              <Link href={`/employer/invites/accept?token=${encodeURIComponent(token)}`} className="mt-2 inline-block font-semibold underline">Open accept page</Link>
            </section>
          )}
          {isOwner && (
            <form action={inviteMember} className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <input type="hidden" name="organizationId" value={orgId} />
              <label className="block text-sm font-medium text-slate-800">
                Email
                <input name="email" type="email" required autoComplete="email" className={fieldClass} />
              </label>
              <label className="block text-sm font-medium text-slate-800">
                Role
                <select name="role" defaultValue="recruiter_dispatcher" className={fieldClass}>
                  {ORG_MEMBER_ROLES.map((role) => (
                    <option key={role.code} value={role.code}>{role.label}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Create invite</button>
            </form>
          )}
          <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {roster.map((member) => (
              <li key={member.user_id} className="space-y-3 p-4">
                <div>
                  <p className="font-medium text-slate-900">{member.display_name}</p>
                  <p className="text-sm text-slate-600">{member.email}</p>
                  <p className="text-sm text-slate-800">{orgRoleLabel(member.role)}</p>
                </div>
                {isOwner && member.user_id !== ctx.userId && (
                  <form action={changeMemberRole} className="flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="organizationId" value={orgId} />
                    <input type="hidden" name="userId" value={member.user_id} />
                    <label className="sr-only" htmlFor={`role-${member.user_id}`}>Role for {member.display_name}</label>
                    <select id={`role-${member.user_id}`} name="role" defaultValue={member.role} className={fieldClass}>
                      {ORG_MEMBER_ROLES.map((role) => (
                        <option key={role.code} value={role.code}>{role.label}</option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900">Save role</button>
                  </form>
                )}
                {membership && (isOwner || member.user_id === ctx.userId) && (
                  <form action={removeMember}>
                    <input type="hidden" name="organizationId" value={orgId} />
                    <input type="hidden" name="userId" value={member.user_id} />
                    <button type="submit" className="text-sm font-medium text-slate-700 underline">
                      {member.user_id === ctx.userId ? "Leave organization" : "Remove"}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <section className="mt-4">
              <h2 className="font-semibold text-slate-900">Open invites</h2>
              <ul className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {(invites ?? []).length === 0 && <li className="p-4 text-sm text-slate-600">No open invites.</li>}
                {(invites ?? []).map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                    <span>
                      <span className="block font-medium text-slate-900">{invite.email}</span>
                      <span className="block text-slate-600">{orgRoleLabel(invite.role)} · expires {new Date(invite.expires_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}</span>
                    </span>
                    <form action={revokeInvite}>
                      <input type="hidden" name="organizationId" value={orgId} />
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <button type="submit" className="font-medium text-slate-700 underline">Revoke</button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
