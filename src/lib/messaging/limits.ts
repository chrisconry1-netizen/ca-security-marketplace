/** Keep these in sync with supabase/migrations/20261026143100_messaging.sql. */

export const MESSAGE_BODY_MAX = 8000;
export const MESSAGE_RATE_PER_MINUTE = 30;
export const MESSAGE_RATE_PER_DAY = 400;
export const ATTACHMENT_MAX_COUNT = 3;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CONVERSATION_RATE_PER_DAY = 40;
export const OUTREACH_PER_USER_PER_DAY = 5;
export const OUTREACH_PER_ORG_PER_DAY = 5;
export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 80;
export const VOICE_DURATION_MIN_MS = 1;
export const VOICE_DURATION_MAX_MS = 300_000;
export const VOICE_CODECS = ["audio/webm", "audio/mp4", "audio/ogg"] as const;
export type VoiceCodec = (typeof VOICE_CODECS)[number];
export const ATTACHMENT_URL_TTL_SECONDS = 300;

export const REPORT_REASONS = [
  "harassment",
  "spam",
  "inappropriate",
  "safety",
  "phishing",
  "fake_job",
  "fake_credential",
  "payment_scam",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: "Harassment",
  spam: "Spam",
  inappropriate: "Inappropriate",
  safety: "Safety",
  phishing: "Phishing",
  fake_job: "Fake job",
  fake_credential: "Fake credential",
  payment_scam: "Payment scam",
  other: "Other",
};
