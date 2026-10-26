import { AppShell } from "@/components/app-shell";
import { JobResults } from "@/components/jobs/results";
import { workerNav } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { loadMarketplace } from "@/server/jobs/search";

export default async function WorkerShiftsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("worker");
  const sp = await searchParams;
  const supabase = await createClient();
  const [result, types, profile] = await Promise.all([
    loadMarketplace(sp, "/worker/shifts"),
    supabase.from("credential_types").select("code, name").eq("is_active", true).order("name"),
    supabase.from("worker_profiles").select("city, county, postal_code, work_radius_miles").eq("user_id", ctx.userId).maybeSingle(),
  ]);
  const area = profile.data;
  const nearHref = area?.city
    ? `/worker/shifts?near=${encodeURIComponent(area.city)}&county=${encodeURIComponent(area.county ?? "")}&radius=${area.work_radius_miles ?? 25}`
    : area?.postal_code
      ? `/worker/shifts?near=${encodeURIComponent(area.postal_code)}&radius=${area.work_radius_miles ?? 25}`
      : null;
  return (
    <AppShell ctx={ctx} title="Worker" nav={workerNav}>
      {nearHref && (
        <a href={nearHref} className="mt-2 inline-flex min-h-11 items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          Near my city
        </a>
      )}
      <div className="mt-4">
        <JobResults
          action="/worker/shifts"
          input={result.input}
          rows={result.rows}
          total={result.total}
          credentials={types.data ?? []}
          showEligible
          notice={result.notice}
          originLabel={result.originLabel}
          errorCode={typeof sp.error === "string" ? sp.error : undefined}
        />
      </div>
    </AppShell>
  );
}
