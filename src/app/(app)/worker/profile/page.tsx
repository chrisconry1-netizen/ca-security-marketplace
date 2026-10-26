import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/ui";
import { categoryLabel, WEEKDAYS } from "@/lib/workers/categories";
import { credentialTimeState } from "@/lib/workers/expiry";
import { PROFILE_MESSAGES } from "@/lib/workers/messages";
import { locationLine, payLine, relationName } from "@/lib/workers/present";
import { maskCredentialNumber } from "@/lib/workers/validation";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { signOwnAvatar } from "@/server/storage/signed-urls";
import { StatusBadge } from "@/components/status-badge";

const nav = [
  { href: "/worker/profile", label: "Profile", ready: true },
  { href: "/worker/credentials", label: "Credentials", ready: true },
  { href: "/worker/availability", label: "Availability", ready: true },
  { href: "/worker/shifts", label: "Find shifts" },
];

export default async function WorkerProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("worker");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: profile }, { data: worker }, { data: credentials }, { data: availability }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_path").eq("id", ctx.userId).single(),
    supabase
      .from("worker_profiles")
      .select("headline, bio, city, county, postal_code, work_radius_miles, years_experience, security_experience, has_le_experience, le_experience_summary, preferred_categories, min_hourly_rate_cents, has_transportation, languages, skills, is_searchable")
      .eq("user_id", ctx.userId)
      .maybeSingle(),
    supabase
      .from("credentials")
      .select("id, status, credential_number, expires_on, credential_types(name)")
      .order("created_at", { ascending: false }),
    supabase.from("worker_availability").select("id, weekday, start_time, end_time, is_available").not("weekday", "is", null).order("weekday"),
  ]);
  const photo = await signOwnAvatar(profile?.avatar_path, ctx.userId);

  return (
    <AppShell ctx={ctx} title="Worker" nav={nav}>
      <Notice code={sp.notice} tone="info" messages={PROFILE_MESSAGES} />
      <Notice code={sp.error} messages={PROFILE_MESSAGES} />
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Your profile</h1>
        <Link href="/worker/profile/edit" className="shrink-0 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
          Edit profile
        </Link>
      </div>
      {!worker && <p className="mt-4 text-sm text-slate-600">Your worker profile is not ready yet.</p>}
      {worker && (
        <div className="mt-4 space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              {photo ? (
                // Signed URL from the private avatars bucket. Next/Image would need a remote pattern for a short-lived host.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="Profile photo" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-lg font-bold text-slate-700" aria-hidden>
                  {(profile?.display_name ?? "?").slice(0, 1)}
                </div>
              )}
              <div>
                <p className="text-xl font-bold text-slate-900">{profile?.display_name}</p>
                <p className="text-sm text-slate-600">{worker.headline || "No headline yet"}</p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-sm text-slate-800">
              <div>
                <dt className="font-medium text-slate-500">General location</dt>
                <dd>{locationLine(worker.city, worker.county, worker.postal_code)}</dd>
                <dd className="text-xs text-slate-500">City, county, and ZIP only. A street address is not stored.</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Work radius</dt>
                <dd>{worker.work_radius_miles ? `${worker.work_radius_miles} miles` : "Not set"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Minimum pay</dt>
                <dd>{payLine(worker.min_hourly_rate_cents)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Transportation</dt>
                <dd>{worker.has_transportation == null ? "Not specified" : worker.has_transportation ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Employer search</dt>
                <dd>{worker.is_searchable ? "Visible to employers" : "Hidden from employer search"}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">About</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{worker.bio || "No bio yet."}</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Security experience</h2>
            <p className="mt-2 text-sm text-slate-700">
              {worker.years_experience == null ? "Years not set" : `${worker.years_experience} years`}
            </p>
            {worker.security_experience && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{worker.security_experience}</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Law-enforcement experience</h2>
            <p className="mt-1 text-xs text-slate-500">This is context you choose to share. It is not a verification and does not authorize off-duty work.</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
              {worker.has_le_experience ? worker.le_experience_summary || "Experience noted, no details added." : "None listed."}
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Preferred assignments</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {(worker.preferred_categories ?? []).length === 0 && <li className="text-sm text-slate-600">None selected.</li>}
              {(worker.preferred_categories ?? []).map((code: string) => (
                <li key={code} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800">
                  {categoryLabel(code)}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Languages and skills</h2>
            <p className="mt-2 text-sm text-slate-700">Languages: {(worker.languages ?? []).join(", ") || "None listed"}</p>
            <p className="mt-1 text-sm text-slate-700">Skills: {(worker.skills ?? []).join(", ") || "None listed"}</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Weekly availability</h2>
              <Link href="/worker/availability" className="text-sm font-medium text-slate-900 underline">
                Edit
              </Link>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {(availability ?? []).length === 0 && <li>No weekly windows yet.</li>}
              {(availability ?? []).map((row) => (
                <li key={row.id}>
                  {WEEKDAYS[row.weekday ?? 0]} {String(row.start_time).slice(0, 5)}–{String(row.end_time).slice(0, 5)}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Credentials</h2>
              <Link href="/worker/credentials" className="text-sm font-medium text-slate-900 underline">
                Manage
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-slate-100">
              {(credentials ?? []).length === 0 && <li className="py-2 text-sm text-slate-600">No credentials yet.</li>}
              {(credentials ?? []).map((row) => {
                const timeState = credentialTimeState(row.status, row.expires_on);
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <Link href={`/worker/credentials/${row.id}`} className="font-medium text-slate-900 underline">
                        {relationName(row.credential_types as { name: string } | { name: string }[] | null)}
                      </Link>
                      <p className="text-xs text-slate-500">{maskCredentialNumber(row.credential_number)}</p>
                    </div>
                    <StatusBadge status={row.status} timeState={timeState} />
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </AppShell>
  );
}
