import { redirect } from "next/navigation";
import { AuthCard, Notice } from "@/components/ui";
import { requireUser } from "@/server/auth/guards";
import { homePathFor } from "@/lib/auth/roles";
import { selectAccountType } from "../actions";

export default async function AccountTypePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireUser("/account-type");
  if (ctx.profile.account_type !== null) redirect(homePathFor(ctx.profile, ctx.roles));
  const sp = await searchParams;
  const option = "block w-full rounded-xl border-2 border-slate-200 p-4 text-left hover:border-slate-900 focus:border-slate-900 focus:outline-none";
  return (
    <AuthCard title="How will you use the marketplace?" subtitle="This can't be changed later without contacting support.">
      <Notice code={sp.error} />
      <form action={selectAccountType} className="space-y-3">
        <button type="submit" name="accountType" value="worker" className={option}>
          <span className="block text-lg font-semibold text-slate-900">I need security work</span>
          <span className="block text-sm text-slate-600">Guards, armed guards, EP, event, patrol, supervisors, eligible off-duty officers.</span>
        </button>
        <button type="submit" name="accountType" value="employer" className={option}>
          <span className="block text-lg font-semibold text-slate-900">I need security staff</span>
          <span className="block text-sm text-slate-600">Licensed PPOs and other eligible security employers. Organization verification required.</span>
        </button>
      </form>
    </AuthCard>
  );
}
