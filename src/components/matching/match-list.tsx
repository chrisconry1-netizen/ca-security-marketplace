import { matchSourceCopy, parseChecklist, type ChecklistItem } from "@/lib/matching/messages";

export function MatchSourceBanner({ source, fallbackReason }: { source: string; fallbackReason: string | null }) {
  return (
    <p role="status" className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
      {matchSourceCopy(source, fallbackReason)}
    </p>
  );
}

export function EligibilityChecklist({ items }: { items: ChecklistItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-3">
      <h3 className="text-sm font-semibold text-slate-900">Eligibility checklist</h3>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item.code} className="text-sm text-slate-700">
            <span className="font-medium text-slate-900">{item.applicable ? (item.passed ? "Met" : "Not met") : "Does not apply"}.</span> {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function suggestionChecklist(value: unknown): ChecklistItem[] {
  return parseChecklist(value);
}
