import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

// Mirrors supabase/config.toml: min 12, lower+upper+digit. Enforced server-side by Supabase Auth too.
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be at most 128 characters.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[0-9]/, "Password must include a number.");

export const registerSchema = z
  .object({
    displayName: z.string().trim().min(1, "Enter your name.").max(80),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal("on", { error: "You must accept the terms." }),
  })
  .refine((v) => v.password === v.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] });

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });

export const forgotSchema = z.object({ email: emailSchema });

export const resetSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] });

export const accountTypeSchema = z.enum(["worker", "employer"]);

export const AUTH_AUDIT_ACTIONS = ["auth.login", "auth.logout", "auth.password_updated"] as const;
export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[number];

/** Fixed message catalogue: query-string codes never render user-controlled text. */
export const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  email_not_confirmed: "Please verify your email before signing in. Check your inbox.",
  invalid_input: "Please check the form and try again.",
  weak_password: "Password does not meet the requirements.",
  password_mismatch: "Passwords do not match.",
  rate_limited: "Too many attempts. Please wait a minute and try again.",
  link_invalid: "That link is invalid or has expired. Request a new one.",
  generic: "Something went wrong. Please try again.",
  reset_sent: "If an account exists for that email, a reset link is on its way.",
  password_updated: "Your password was updated.",
  signed_out: "You have been signed out.",
  account_type_locked: "Your account type is already set. Contact support to change it.",
  forbidden: "You do not have access to that area.",
};

export function authMessage(code: unknown): string | null {
  return typeof code === "string" && Object.hasOwn(AUTH_MESSAGES, code) ? AUTH_MESSAGES[code] : null;
}
