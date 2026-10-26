import { SECURITY_CATEGORIES } from "@/lib/workers/categories";
import { JOB_TYPES, PAY_TYPES, SHIFT_PERIODS } from "./constants";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function formatJobPay(type: string, min: number | null, max: number | null): string {
  if (min == null) return "Pay not listed";
  const range = max != null && max !== min ? `${money(min)}–${money(max)}` : money(min);
  if (type === "hourly") return `${range} / hour`;
  if (type === "flat") return `${range} flat`;
  if (type === "salary") return `${range} salary`;
  return `${range} estimated`;
}

export function formatDistance(miles: number | null): string | null {
  if (miles == null || Number.isNaN(miles)) return null;
  if (miles < 1) return "Under 1 mi";
  return `About ${Math.round(miles)} mi`;
}

export function formatShiftWhen(starts: string | null, ends: string | null, period: string | null): string {
  if (!starts) return "Schedule to be confirmed";
  const start = new Date(starts);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(start);
  const endTime = ends
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(new Date(ends))
    : null;
  const bucket = SHIFT_PERIODS.find((item) => item.code === period)?.label.split(" ")[0] ?? null;
  return [date, endTime ? `${time}–${endTime}` : time, bucket].filter(Boolean).join(" · ");
}

export function embedded<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function pacificLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const hour = part("hour");
  return `${part("year")}-${part("month")}-${part("day")}T${hour === "24" ? "00" : hour}:${part("minute")}`;
}

export function pacificDate(iso: string | null): string {
  const value = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export function jobTypeLabel(code: string): string {
  return JOB_TYPES.find((item) => item.code === code)?.label ?? code;
}

export function payTypeLabel(code: string): string {
  return PAY_TYPES.find((item) => item.code === code)?.label ?? code;
}

export function categoryLabel(code: string): string {
  return SECURITY_CATEGORIES.find((item) => item.code === code)?.label ?? code;
}

export function asNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function expiryLabel(isoDate: string | null, shiftDate: string): string {
  if (!isoDate) return "No expiration on file";
  const [year, month] = isoDate.split("-");
  const shown = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${year}-${month}-02T00:00:00Z`));
  return isoDate < shiftDate ? `Expired ${shown}` : `Through ${shown}`;
}
