/** Matches public.credential_time_state: Pacific calendar, 30-day verified window. */
export const EXPIRING_SOON_DAYS = 30;

export type CredentialTimeState = "none" | "valid" | "expiring_soon" | "expired";
export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected" | "expired";

export function pacificToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function credentialTimeState(
  status: VerificationStatus | string,
  expiresOn: string | null | undefined,
  today = pacificToday(),
): CredentialTimeState {
  const expires = expiresOn ? expiresOn.slice(0, 10) : null;
  if (status === "expired") return "expired";
  if (expires && expires < today && (status === "verified" || status === "pending" || status === "unverified")) {
    return "expired";
  }
  if (!expires) return "none";
  if (status === "verified" && expires <= addDays(today, EXPIRING_SOON_DAYS)) return "expiring_soon";
  return "valid";
}

export function statusLabel(status: string, timeState: CredentialTimeState): string {
  if (timeState === "expired" || status === "expired") return "Expired";
  if (status === "verified" && timeState === "expiring_soon") return "Verified · expiring soon";
  if (status === "pending") return "Pending review";
  if (status === "verified") return "Verified";
  if (status === "rejected") return "Rejected";
  return "Unverified";
}
