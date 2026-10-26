"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/redirect";
import { accountTypeSchema, forgotSchema, loginSchema, registerSchema, resetSchema } from "@/lib/auth/validation";
import { recordAuthEvent } from "@/server/audit/audit";

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
}

function withNext(path: string, next: string | undefined) {
  return next ? `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(safeNextPath(next))}` : path;
}

export async function login(fd: FormData) {
  const next = str(fd, "next");
  const parsed = loginSchema.safeParse({ email: str(fd, "email"), password: str(fd, "password") });
  if (!parsed.success) redirect(withNext("/login?error=invalid_input", next));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    const code = error.code === "email_not_confirmed" ? "email_not_confirmed" : error.status === 429 ? "rate_limited" : "invalid_credentials";
    redirect(withNext(`/login?error=${code}`, next));
  }
  await recordAuthEvent(supabase, "auth.login");
  redirect(safeNextPath(next));
}

export async function register(fd: FormData) {
  const parsed = registerSchema.safeParse({
    displayName: str(fd, "displayName"),
    email: str(fd, "email"),
    password: str(fd, "password"),
    confirmPassword: str(fd, "confirmPassword"),
    acceptTerms: str(fd, "acceptTerms"),
  });
  if (!parsed.success) {
    const pw = parsed.error.issues.some((i) => i.path[0] === "password");
    const mm = parsed.error.issues.some((i) => i.path[0] === "confirmPassword");
    redirect(`/register?error=${pw ? "weak_password" : mm ? "password_mismatch" : "invalid_input"}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // display_name is cosmetic; account type/roles are NEVER taken from metadata.
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${publicEnv.appUrl}/auth/confirm?next=/account-type`,
    },
  });
  if (error) {
    if (error.status === 429) redirect("/register?error=rate_limited");
    if (error.code === "weak_password") redirect("/register?error=weak_password");
    // Do not reveal whether the email already exists.
    if (error.code !== "user_already_exists") redirect("/register?error=generic");
  }
  redirect("/verify-email");
}

export async function requestPasswordReset(fd: FormData) {
  const parsed = forgotSchema.safeParse({ email: str(fd, "email") });
  if (!parsed.success) redirect("/forgot-password?error=invalid_input");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.appUrl}/auth/confirm?next=/reset-password`,
  });
  if (error?.status === 429) redirect("/forgot-password?error=rate_limited");
  redirect("/forgot-password?notice=reset_sent"); // same response whether or not the account exists
}

export async function updatePassword(fd: FormData) {
  const parsed = resetSchema.safeParse({ password: str(fd, "password"), confirmPassword: str(fd, "confirmPassword") });
  if (!parsed.success) {
    const mm = parsed.error.issues.some((i) => i.path[0] === "confirmPassword");
    redirect(`/reset-password?error=${mm ? "password_mismatch" : "weak_password"}`);
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=link_invalid");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirect(`/reset-password?error=${error.code === "weak_password" || error.code === "same_password" ? "weak_password" : "generic"}`);
  await recordAuthEvent(supabase, "auth.password_updated");
  await supabase.auth.signOut({ scope: "others" });
  redirect("/dashboard?notice=password_updated");
}

export async function logout() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) await recordAuthEvent(supabase, "auth.logout");
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?notice=signed_out");
}

export async function selectAccountType(fd: FormData) {
  const parsed = accountTypeSchema.safeParse(str(fd, "accountType"));
  if (!parsed.success) redirect("/account-type?error=invalid_input");
  const supabase = await createClient();
  const { error } = await supabase.rpc("select_account_type", { p_account_type: parsed.data });
  if (error) redirect(`/account-type?error=${error.code === "42501" ? "account_type_locked" : "generic"}`);
  redirect(parsed.data === "worker" ? "/worker" : "/employer");
}
