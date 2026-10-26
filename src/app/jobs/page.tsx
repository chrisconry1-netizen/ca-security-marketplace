import Link from "next/link";
import { JobResults } from "@/components/jobs/results";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/server/auth/guards";
import { loadMarketplace } from "@/server/jobs/search";

export default async function PublicJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [ctx, result, types] = await Promise.all([
    getSessionContext(),
    loadMarketplace(sp, "/jobs"),
    (await createClient()).from("credential_types").select("code, name").eq("is_active", true).order("name"),
  ]);
  const worker = ctx?.roles.includes("worker") ?? false;
  return (
    <main className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-bold text-slate-900">
            Shifts
          </Link>
          <Link href={ctx ? "/dashboard" : "/login?next=/jobs"} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">
            {ctx ? "Account" : "Sign in"}
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6">
        <JobResults
          action="/jobs"
          input={result.input}
          rows={result.rows}
          total={result.total}
          credentials={types.data ?? []}
          showEligible={worker}
          notice={result.notice}
          originLabel={result.originLabel}
          errorCode={typeof sp.error === "string" ? sp.error : undefined}
        />
      </div>
    </main>
  );
}
