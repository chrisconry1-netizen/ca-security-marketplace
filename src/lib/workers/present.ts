import { WEEKDAYS } from "./categories";
import { centsToDollars } from "./validation";

export function relationName(value: { name: string } | { name: string }[] | null | undefined): string {
  if (!value) return "Credential";
  return Array.isArray(value) ? (value[0]?.name ?? "Credential") : value.name;
}

export function locationLine(city: string | null, county: string | null, postal: string | null): string {
  const parts = [city, county, postal].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" · ") : "Not set";
}

export function payLine(cents: number | null): string {
  if (cents == null) return "No minimum set";
  return `$${centsToDollars(cents)} / hour minimum`;
}

export function weekdayName(day: number): string {
  return WEEKDAYS[day] ?? `Day ${day}`;
}

export function clock(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 5);
}
