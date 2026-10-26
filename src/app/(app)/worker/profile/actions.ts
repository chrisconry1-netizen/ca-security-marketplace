"use server";

import { redirect } from "next/navigation";
import { emptyToNull, formString, formStrings } from "@/lib/form";
import { LANGUAGES } from "@/lib/workers/categories";
import { dollarsToCents, parseAdditionalLanguage, parseSkills, profileErrorCode, profileSchema } from "@/lib/workers/validation";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { uploadAvatar } from "@/server/storage/uploads";

export async function saveWorkerProfile(fd: FormData) {
  const ctx = await requireArea("worker");
  const additionalRaw = formString(fd, "additionalLanguage");
  const parsed = profileSchema.safeParse({
    displayName: formString(fd, "displayName"),
    headline: formString(fd, "headline"),
    bio: formString(fd, "bio"),
    city: formString(fd, "city"),
    county: formString(fd, "county"),
    postalCode: formString(fd, "postalCode"),
    workRadiusMiles: formString(fd, "workRadiusMiles"),
    yearsExperience: formString(fd, "yearsExperience"),
    securityExperience: formString(fd, "securityExperience"),
    hasLeExperience: formString(fd, "hasLeExperience") === "yes",
    leExperienceSummary: formString(fd, "leExperienceSummary"),
    categories: formStrings(fd, "categories"),
    minHourlyRate: formString(fd, "minHourlyRate"),
    transportation: formString(fd, "transportation"),
    languages: formStrings(fd, "languages").filter((lang) => (LANGUAGES as readonly string[]).includes(lang)),
    additionalLanguage: additionalRaw,
    skills: formString(fd, "skills"),
    searchable: formString(fd, "searchable") === "yes",
  });
  if (!parsed.success) redirect(`/worker/profile/edit?error=${profileErrorCode(parsed.error)}`);

  const skills = parseSkills(parsed.data.skills);
  if (!skills) redirect("/worker/profile/edit?error=invalid_input");
  let additional: string | null = null;
  if (additionalRaw.trim()) {
    additional = parseAdditionalLanguage(additionalRaw);
    if (!additional) redirect("/worker/profile/edit?error=invalid_input");
  }
  const languages: string[] = [...parsed.data.languages];
  if (additional && !languages.some((lang) => lang.toLowerCase() === additional!.toLowerCase())) languages.push(additional);
  if (languages.length > 20) redirect("/worker/profile/edit?error=invalid_input");

  const data = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("worker_profiles")
    .update({
      headline: emptyToNull(data.headline),
      bio: emptyToNull(data.bio),
      city: emptyToNull(data.city),
      county: emptyToNull(data.county),
      postal_code: emptyToNull(data.postalCode),
      work_radius_miles: data.workRadiusMiles === "" ? null : data.workRadiusMiles,
      years_experience: data.yearsExperience === "" ? null : data.yearsExperience,
      security_experience: emptyToNull(data.securityExperience),
      has_le_experience: data.hasLeExperience,
      le_experience_summary: data.hasLeExperience ? emptyToNull(data.leExperienceSummary) : null,
      preferred_categories: data.categories,
      min_hourly_rate_cents: dollarsToCents(data.minHourlyRate),
      has_transportation: data.transportation === "" ? null : data.transportation === "yes",
      languages,
      skills,
      is_searchable: data.searchable,
    })
    .eq("user_id", ctx.userId);
  if (error) {
    console.error("profile.update_failed", error.code);
    redirect("/worker/profile/edit?error=invalid_input");
  }

  const { error: nameError } = await supabase.from("profiles").update({ display_name: data.displayName }).eq("id", ctx.userId);
  if (nameError) {
    console.error("profile.name_failed", nameError.code);
    redirect("/worker/profile/edit?error=generic");
  }

  const photo = fd.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const path = await uploadAvatar(supabase, ctx.userId, photo);
    if (!path) redirect("/worker/profile/edit?error=upload_failed");
    const { data: current } = await supabase.from("profiles").select("avatar_path").eq("id", ctx.userId).single();
    const { error: avatarError } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", ctx.userId);
    if (avatarError) {
      console.error("profile.avatar_failed", avatarError.code);
      redirect("/worker/profile/edit?error=upload_failed");
    }
    if (current?.avatar_path && current.avatar_path !== path) {
      await supabase.storage.from("avatars").remove([current.avatar_path]);
    }
  }

  redirect("/worker/profile?notice=saved");
}
