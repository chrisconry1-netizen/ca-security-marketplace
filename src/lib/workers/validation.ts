import { z } from "zod";
import { LANGUAGES, SECURITY_CATEGORY_CODES, VERIFICATION_METHODS } from "./categories";

const STREET = /\b(street|avenue|boulevard|highway|drive|lane|court|place|terrace|circle|road)\b/i;
const LEADING_NUMBER = /^\s*\d+\b/;

export function looksLikeStreetAddress(value: string): boolean {
  return LEADING_NUMBER.test(value) || STREET.test(value);
}

const placeName = z
  .string()
  .trim()
  .max(80)
  .refine((v) => v.length === 0 || !looksLikeStreetAddress(v), { message: "street" });

const languageName = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\p{L}][\p{L}\s.'-]{0,39}$/u, "language");

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, "name").max(80),
  headline: z.string().trim().max(140),
  bio: z.string().trim().max(4000),
  city: placeName,
  county: placeName,
  postalCode: z.string().trim().regex(/^$|^\d{5}(-\d{4})?$/, "zip"),
  workRadiusMiles: z.union([z.literal(""), z.coerce.number().int().min(1).max(500)]),
  yearsExperience: z.union([z.literal(""), z.coerce.number().int().min(0).max(70)]),
  securityExperience: z.string().trim().max(4000),
  hasLeExperience: z.boolean(),
  leExperienceSummary: z.string().trim().max(2000),
  categories: z.array(z.enum(SECURITY_CATEGORY_CODES)).max(SECURITY_CATEGORY_CODES.length),
  minHourlyRate: z
    .string()
    .trim()
    .regex(/^$|^\d{1,4}(\.\d{1,2})?$/, "pay")
    .refine((v) => v === "" || dollarsToCents(v)! <= 100_000, "pay"),
  transportation: z.enum(["", "yes", "no"]),
  languages: z.array(z.enum(LANGUAGES)).max(LANGUAGES.length),
  additionalLanguage: z.string().trim().max(40),
  skills: z.string().trim().max(800),
  searchable: z.boolean(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export function dollarsToCents(input: string): number | null {
  if (!input) return null;
  const [dollars, fraction = ""] = input.split(".");
  const cents = Number(dollars) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isInteger(cents) || cents < 0) return null;
  return cents;
}

export function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

const SKILL = /^[\p{L}\p{N}][\p{L}\p{N} .&/'+-]{0,39}$/u;

export function parseSkills(input: string): string[] | null {
  if (!input.trim()) return [];
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 30) return null;
  const unique: string[] = [];
  for (const part of parts) {
    if (!SKILL.test(part)) return null;
    if (!unique.some((u) => u.toLowerCase() === part.toLowerCase())) unique.push(part);
  }
  return unique;
}

export function parseAdditionalLanguage(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const parsed = languageName.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function profileErrorCode(error: z.ZodError): "address_not_allowed" | "invalid_input" {
  if (error.issues.some((issue) => issue.message === "street")) return "address_not_allowed";
  return "invalid_input";
}

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const credentialSchema = z
  .object({
    credentialTypeId: z.string().uuid(),
    credentialNumber: z.string().trim().max(64),
    issuer: z.string().trim().max(160),
    issuedOn: z.union([z.literal(""), dateField]),
    expiresOn: z.union([z.literal(""), dateField]),
  })
  .refine((v) => v.issuedOn === "" || v.expiresOn === "" || v.expiresOn >= v.issuedOn, { path: ["expiresOn"] });

export const submitReady = z.object({
  credentialNumber: z.string().trim().min(1).max(64),
  issuer: z.string().trim().min(1).max(160),
  issuedOn: dateField,
  expiresOn: z.union([z.literal(""), dateField]),
});

export const availabilityWindowSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export const availabilityExceptionSchema = z.object({
  date: dateField,
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  kind: z.enum(["available", "blackout"]),
  note: z.string().trim().max(200),
});

export const reviewSchema = z.object({
  credentialId: z.string().uuid(),
  decision: z.enum(["verified", "rejected"]),
  method: z.enum(VERIFICATION_METHODS.map((m) => m.code) as [string, ...string[]]),
  sourceReference: z.string().trim().max(500),
  notes: z.string().trim().max(4000),
  validUntil: z.union([z.literal(""), dateField]),
});

export function maskCredentialNumber(value: string | null | undefined): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `•••• ${trimmed.slice(-4)}`;
}
