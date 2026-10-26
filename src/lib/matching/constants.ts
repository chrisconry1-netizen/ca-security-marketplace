/** Closed reason codes. SQL app.match_supported_codes must accept this same set. */
export const REASON_CODES = [
  "GUARD_CARD_ACTIVE",
  "FIREARM_PERMIT_ACTIVE",
  "EP_TRAINING_ACTIVE",
  "OFF_DUTY_LE_APPROVED",
  "PPO_VERIFIED",
  "ORG_VERIFIED",
  "AVAILABLE",
  "WITHIN_RADIUS",
  "NOT_BLOCKED",
  "NOT_APPLIED",
  "MANDATORY_CREDENTIALS",
  "CATEGORY_MATCH",
  "EXPERIENCE_YEARS",
  "PAY_MEETS_MINIMUM",
  "TRANSPORTATION",
  "URGENCY",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * The only fields a match prompt may contain. Kept in sync with
 * public.record_match_run's prompt_fields array and docs/SECURITY_REVIEW_MATCHING.md.
 */
export const GROK_PROMPT_FIELDS = [
  "id",
  "distance_miles",
  "radius_miles",
  "years_experience",
  "min_years_experience",
  "category_match",
  "pay_type",
  "pay_min_cents",
  "pay_meets_minimum",
  "urgency",
  "shift_period",
  "is_armed",
  "vehicle_required",
  "has_transportation",
  "availability_kind",
  "guard_card_active",
  "firearm_permit_active",
  "ep_training_active",
  "off_duty_le_approved",
  "ppo_requirement_met",
  "mandatory_credentials_met",
] as const;

export type GrokPromptField = (typeof GROK_PROMPT_FIELDS)[number];

/** Keys that must never appear in a Grok payload, at any depth. */
export const FORBIDDEN_PROMPT_KEYS = [
  "credential_number",
  "document",
  "document_path",
  "bio",
  "headline",
  "display_name",
  "email",
  "phone",
  "phone_e164",
  "postal_code",
  "approx_lat",
  "approx_lng",
  "latitude",
  "longitude",
  "site_lat",
  "site_lng",
  "site_address",
  "languages",
  "skills",
  "security_experience",
  "le_experience_summary",
  "agency_name",
  "conviction",
  "criminal",
  "race",
  "ethnicity",
  "gender",
  "sex",
  "religion",
  "disability",
  "age",
  "date_of_birth",
  "national_origin",
] as const;

export const MATCH_RANK_LIMIT = 40;

export const PPO_ORG_TYPES = ["ppo", "private_patrol_operator_branch", "proprietary_security_employer"] as const;

export const EP_CATEGORIES = ["executive_protection", "close_protection"] as const;

export const DETERMINISTIC_MODEL = "deterministic";
export const DETERMINISTIC_VERSION = "v1";

export const MODEL_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
