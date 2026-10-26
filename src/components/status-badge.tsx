import { statusLabel, type CredentialTimeState } from "@/lib/workers/expiry";

export function StatusBadge({ status, timeState }: { status: string; timeState: CredentialTimeState }) {
  const label = statusLabel(status, timeState);
  const tone =
    status === "verified" && timeState !== "expiring_soon" && timeState !== "expired"
      ? "bg-emerald-50 text-emerald-900"
      : status === "rejected" || timeState === "expired" || status === "expired"
        ? "bg-red-50 text-red-900"
        : status === "pending" || timeState === "expiring_soon"
          ? "bg-amber-50 text-amber-950"
          : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

export function Pill({ label, tone = "muted" }: { label: string; tone?: "ok" | "warn" | "muted" | "bad" }) {
  const cls =
    tone === "ok" ? "bg-emerald-50 text-emerald-900" : tone === "warn" ? "bg-amber-50 text-amber-950" : tone === "bad" ? "bg-red-50 text-red-900" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

export function verificationTone(status: string): "ok" | "warn" | "muted" | "bad" {
  if (status === "verified" || status === "published" || status === "completed") return "ok";
  if (status === "pending" || status === "pending_review" || status === "in_progress" || status === "filled") return "warn";
  if (status === "rejected" || status === "expired" || status === "cancelled") return "bad";
  return "muted";
}

export const fieldClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20";
