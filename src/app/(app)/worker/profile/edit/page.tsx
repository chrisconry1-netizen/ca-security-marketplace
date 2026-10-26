import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fieldClass } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { LANGUAGES, SECURITY_CATEGORIES } from "@/lib/workers/categories";
import { PROFILE_MESSAGES } from "@/lib/workers/messages";
import { centsToDollars } from "@/lib/workers/validation";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { signOwnAvatar } from "@/server/storage/signed-urls";
import { saveWorkerProfile } from "../actions";

export default async function EditWorkerProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("worker");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: profile }, { data: worker }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_path").eq("id", ctx.userId).single(),
    supabase
      .from("worker_profiles")
      .select("headline, bio, city, county, postal_code, work_radius_miles, years_experience, security_experience, has_le_experience, le_experience_summary, preferred_categories, min_hourly_rate_cents, has_transportation, languages, skills, is_searchable")
      .eq("user_id", ctx.userId)
      .maybeSingle(),
  ]);
  const photo = await signOwnAvatar(profile?.avatar_path, ctx.userId);
  const selected = new Set<string>(worker?.preferred_categories ?? []);
  const languages = new Set<string>(worker?.languages ?? []);
  const extraLanguage = (worker?.languages ?? []).find((lang: string) => !(LANGUAGES as readonly string[]).includes(lang)) ?? "";

  return (
    <AppShell ctx={ctx} title="Worker" nav={[{ href: "/worker/profile", label: "Profile", ready: true }, { href: "/worker/credentials", label: "Credentials", ready: true }, { href: "/worker/availability", label: "Availability", ready: true }]}>
      <Notice code={sp.error} messages={PROFILE_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Edit profile</h1>
      <p className="mt-1 text-sm text-slate-600">General work area only. Do not enter a home street address, and do not put one in your bio.</p>
      <form action={saveWorkerProfile} className="mt-4 space-y-4">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="h-16 w-16 rounded-full object-cover" />
          )}
          <label className="block text-sm font-medium text-slate-800">
            Profile photo
            <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-sm" />
          </label>
          <p className="text-xs text-slate-500">JPG, PNG, or WebP. 2 MB max. Stored privately.</p>
          <label className="block text-sm font-medium text-slate-800">
            Display name
            <input name="displayName" required maxLength={80} defaultValue={profile?.display_name ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Headline
            <input name="headline" maxLength={140} defaultValue={worker?.headline ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            City
            <input name="city" maxLength={80} defaultValue={worker?.city ?? ""} autoComplete="address-level2" className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            County
            <input name="county" maxLength={80} defaultValue={worker?.county ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            ZIP code
            <input name="postalCode" inputMode="numeric" maxLength={10} defaultValue={worker?.postal_code ?? ""} autoComplete="postal-code" className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Work radius (miles)
            <input name="workRadiusMiles" type="number" min={1} max={500} defaultValue={worker?.work_radius_miles ?? ""} className={fieldClass} />
          </label>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <label className="block text-sm font-medium text-slate-800">
            Bio
            <textarea name="bio" maxLength={4000} rows={4} defaultValue={worker?.bio ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Years of security experience
            <input name="yearsExperience" type="number" min={0} max={70} defaultValue={worker?.years_experience ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Security experience
            <textarea name="securityExperience" maxLength={4000} rows={4} defaultValue={worker?.security_experience ?? ""} className={fieldClass} />
          </label>
          <label className="flex items-start gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" name="hasLeExperience" value="yes" defaultChecked={Boolean(worker?.has_le_experience)} className="mt-1 h-5 w-5" />
            Law enforcement experience
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Law enforcement experience details
            <textarea name="leExperienceSummary" maxLength={2000} rows={3} defaultValue={worker?.le_experience_summary ?? ""} className={fieldClass} />
          </label>
          <p className="text-xs text-slate-500">Optional. Not a verification, and not authorization for off-duty work. Leave the box unchecked to clear details.</p>
        </section>

        <fieldset className="rounded-xl border border-slate-200 bg-white p-4">
          <legend className="px-1 text-sm font-medium text-slate-800">Preferred assignments</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SECURITY_CATEGORIES.map((category) => (
              <label key={category.code} className="flex items-center gap-2 text-sm text-slate-800">
                <input type="checkbox" name="categories" value={category.code} defaultChecked={selected.has(category.code)} className="h-5 w-5" />
                {category.label}
              </label>
            ))}
          </div>
        </fieldset>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <label className="block text-sm font-medium text-slate-800">
            Minimum hourly pay
            <input name="minHourlyRate" inputMode="decimal" placeholder="25.00" defaultValue={centsToDollars(worker?.min_hourly_rate_cents)} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Transportation
            <select name="transportation" defaultValue={worker?.has_transportation == null ? "" : worker.has_transportation ? "yes" : "no"} className={fieldClass}>
              <option value="">Not specified</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Languages</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {LANGUAGES.map((language) => (
                <label key={language} className="flex items-center gap-2 text-sm text-slate-800">
                  <input type="checkbox" name="languages" value={language} defaultChecked={languages.has(language)} className="h-5 w-5" />
                  {language}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-medium text-slate-800">
            Additional language
            <input name="additionalLanguage" maxLength={40} defaultValue={extraLanguage} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Skills
            <input name="skills" maxLength={800} defaultValue={(worker?.skills ?? []).join(", ")} placeholder="Report writing, radio, access control" className={fieldClass} />
          </label>
          <label className="flex items-start gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" name="searchable" value="yes" defaultChecked={Boolean(worker?.is_searchable)} className="mt-1 h-5 w-5" />
            Show my profile to employers
          </label>
          <p className="text-xs text-slate-500">Employers never see a street address. Credential numbers and documents stay private.</p>
        </section>

        <div className="flex gap-3">
          <button type="submit" className="flex-1 rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
            Save profile
          </button>
          <Link href="/worker/profile" className="rounded-lg border border-slate-300 px-4 py-3 text-center text-base font-semibold text-slate-800">
            Cancel
          </Link>
        </div>
      </form>
    </AppShell>
  );
}
