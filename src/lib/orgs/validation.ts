import { z } from "zod";
import { emailSchema } from "@/lib/auth/validation";
import { ORG_TYPE_CODES } from "./constants";

export const orgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  orgType: z.enum(ORG_TYPE_CODES),
  website: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === "" || /^https:\/\/\S+$/.test(value)),
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
  contactPhone: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\+[1-9]\d{6,14}$/.test(value)),
  description: z.string().trim().max(5000),
  serviceCounties: z.string().max(4000),
  licenseType: z.string().trim().max(80),
  licenseNumber: z.string().trim().max(40),
});

export const inviteSchema = z.object({
  organizationId: z.string().uuid(),
  email: emailSchema,
  role: z.enum(["owner_admin", "manager", "recruiter_dispatcher"]),
});

export const reviewOrgSchema = z.object({
  organizationId: z.string().uuid(),
  decision: z.enum(["verified", "rejected"]),
  notes: z.string().trim().min(8).max(4000),
});
