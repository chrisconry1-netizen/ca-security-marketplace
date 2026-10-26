import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/ui";
import { EMPLOYER_MESSAGES } from "@/lib/employer/messages";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { requireUser } from "@/server/auth/guards";
import { acceptInvite } from "../../team/actions";

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = queryValue(sp.token);
  const ctx = await requireUser(`/employer/invites/accept?token=${encodeURIComponent(token)}`);
  return (
    <AppShell ctx={ctx} title="Employer" nav={ctx.profile.account_type === "employer" ? employerNav : []}>
      <Notice code={queryValue(sp.error)} messages={EMPLOYER_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Join organization</h1>
      <p className="mt-1 text-sm text-slate-600">The invite must match this account&apos;s email, and the account must be an employer. A worker account cannot accept it.</p>
      {token ? (
        <form action={acceptInvite} className="mt-4">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Accept invite</button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-slate-600">That invite link is missing a token.</p>
      )}
    </AppShell>
  );
}
