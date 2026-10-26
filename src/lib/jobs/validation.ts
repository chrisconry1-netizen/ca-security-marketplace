import { z } from "zod";
import { SECURITY_CATEGORY_CODES } from "@/lib/workers/categories";
import { looksLikeStreetAddress } from "@/lib/workers/validation";
import { JOB_TYPES, ORG_TYPES, PAY_TYPES, URGENCIES } from "./constants";

const placeName = z
  .string()
  .trim()
  .max(80)
  .refine((value) => value.length === 0 || !looksLikeStreetAddress(value), { message: "street" });

const localTime = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)]);
const money = z.union([z.literal(""), z.string().regex(/^\d{1,4}(\.\d{1,2})?$/)]);

export const organizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  orgType: z.enum(ORG_TYPES.map((item) => item.code) as [string, ...string[]]),
  description: z.string().trim().max(5000),
});

export const jobDraftSchema = z
  .object({
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().min(1).max(10000),
    jobType: z.enum(JOB_TYPES.map((item) => item.code) as [string, ...string[]]),
    category: z.enum(SECURITY_CATEGORY_CODES),
    armed: z.enum(["yes", "no"]),
    urgency: z.enum(URGENCIES.map((item) => item.code) as [string, ...string[]]),
    city: placeName,
    county: placeName,
    postalCode: z.string().trim().regex(/^$|^\d{5}(-\d{4})?$/),
    siteAddress: z.string().trim().max(300),
    siteLat: z.string().trim(),
    siteLng: z.string().trim(),
    approxLat: z.string().trim(),
    approxLng: z.string().trim(),
    startsLocal: localTime,
    endsLocal: localTime,
    payType: z.enum(PAY_TYPES.map((item) => item.code) as [string, ...string[]]),
    payMin: money,
    payMax: money,
    workersNeeded: z.coerce.number().int().min(1).max(500),
    minYears: z.union([z.literal(""), z.coerce.number().int().min(0).max(70)]),
    uniformNotes: z.string().trim().max(2000),
    vehicleRequired: z.boolean(),
    equipmentNotes: z.string().trim().max(2000),
    deadlineLocal: localTime,
    requiredCodes: z.array(z.string().trim().min(1).max(80)).max(20),
    optionalCodes: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .refine((value) => value.startsLocal === "" || value.endsLocal === "" || value.endsLocal > value.startsLocal, { path: ["endsLocal"] });

export function jobErrorCode(error: z.ZodError): "address_not_allowed" | "invalid_input" {
  if (error.issues.some((issue) => issue.message === "street")) return "address_not_allowed";
  return "invalid_input";
}

export function optionalCoord(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^-?\d{1,3}(\.\d{1,6})?$/.test(trimmed)) return "invalid";
  const number = Number(trimmed);
  if (!Number.isFinite(number)) return "invalid";
  return number;
}
