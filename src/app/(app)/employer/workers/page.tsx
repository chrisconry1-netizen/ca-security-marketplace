import { AppShell } from "@/components/app-shell";
import { openConversation } from "@/app/(app)/messages/actions";
import { employerNav } from "@/lib/employer/nav";
import { queryValue } from "@/lib/form";
import { cityContainsPattern } from "@/lib/messaging/validation";
import { MESSAGING_MESSAGES } from "@/lib/messaging/messages";
import { Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";

export default async function FindWorkersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("employer");
  const sp = await searchParams;
  const cityRaw = queryValue(sp.city);
  const pattern = cityContainsPattern(cityRaw);
  const supabase = await createClient();
  const orgIds = ctx.orgMemberships.map((membership) => membership.organization_id);
  const { data: orgRows } = orgIds.length
    ? await supabase.from("organizations").select("id, name").in("id", orgIds)
    : { data: [] };
  const orgNames = new Map((orgRows ?? []).map((org) => [org.id, org.name]));
  let query = supabase
    .from("worker_search_cards")
    .select("user_id, display_name, headline, city, county, years_experience")
    .order("display_name")
    .limit(50);
  if (pattern) query = query.ilike("city", pattern);
  const { data: workers, error } = ctx.orgMemberships.length ? await query : { data: [], error: null };

  return (
    <AppShell ctx={ctx} title="Employer" nav={employerNav}>
      <Notice code={queryValue(sp.error)} messages={MESSAGING_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Find workers</h1>
      <p className="mt-1 text-sm text-slate-600">
        Only workers who opted in appear here. Outreach is limited, and a worker can block further messages. GuardGig does not employ them.
      </p>
      <form method="get" className="mt-4 flex gap-2">
        <label className="sr-only" htmlFor="city">
          City
        </label>
        <input id="city" name="city" defaultValue={cityRaw} maxLength={80} placeholder="City" className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3 text-base" />
        <button type="submit" className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">
          Filter
        </button>
      </form>
      {ctx.orgMemberships.length === 0 && <p className="mt-4 text-sm text-slate-600">Create an organization before messaging a worker.</p>}
      {error && <p className="mt-4 text-sm text-red-800">Workers could not be loaded.</p>}
      <ul className="mt-4 space-y-3">
        {(workers ?? []).length === 0 && !error && ctx.orgMemberships.length > 0 && (
          <li className="text-sm text-slate-600">No workers have opted in to search.</li>
        )}
        {(workers ?? []).map((worker) => (
          <li key={worker.user_id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">{worker.display_name}</h2>
            {worker.headline && <p className="mt-1 text-sm text-slate-700">{worker.headline}</p>}
            <p className="mt-1 text-sm text-slate-600">
              {[worker.city, worker.county].filter(Boolean).join(" · ") || "Area not listed"}
              {worker.years_experience != null ? ` · ${worker.years_experience} years` : ""}
            </p>
            <form action={openConversation} className="mt-3 space-y-2">
              <input type="hidden" name="workerId" value={worker.user_id} />
              <input type="hidden" name="returnTo" value="/employer/workers" />
              {ctx.orgMemberships.length === 1 ? (
                <input type="hidden" name="organizationId" value={ctx.orgMemberships[0]?.organization_id} />
              ) : (
                <label className="block text-sm font-medium text-slate-800">
                  Organization
                  <select name="organizationId" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" required>
                    {ctx.orgMemberships.map((membership) => (
                      <option key={membership.organization_id} value={membership.organization_id}>
                      {orgNames.get(membership.organization_id) || "Organization"}
                    </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="submit" className="min-h-11 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
                Message
              </button>
            </form>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
