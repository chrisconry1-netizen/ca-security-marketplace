const ZONE = "America/Los_Angeles";

function partsInZone(date: Date, timeZone: string): Record<string, string> {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

/** Wall-clock date and time in Pacific, stored as a UTC instant. */
export function pacificWallTimeToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = partsInZone(utcGuess, ZONE);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const corrected = new Date(utcGuess.getTime() - (asUtc - utcGuess.getTime()));
  const check = partsInZone(corrected, ZONE);
  if (check.year !== String(year) || Number(check.month) !== month || Number(check.day) !== day || Number(check.hour) !== hour || Number(check.minute) !== minute) {
    return null;
  }
  return corrected.toISOString();
}

export function isoToPacificParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
  const parts = partsInZone(parsed, ZONE);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function formatPacific(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
