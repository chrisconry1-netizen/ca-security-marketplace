import { AppShell } from "@/components/app-shell";
import { fieldClass } from "@/components/status-badge";
import { Notice } from "@/components/ui";
import { WEEKDAYS } from "@/lib/workers/categories";
import { PROFILE_MESSAGES } from "@/lib/workers/messages";
import { clock, weekdayName } from "@/lib/workers/present";
import { formatPacific } from "@/lib/workers/time";
import { createClient } from "@/lib/supabase/server";
import { requireArea } from "@/server/auth/guards";
import { addDateException, addWeeklyWindow, removeAvailability } from "./actions";

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireArea("worker");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: rows } = await supabase.from("worker_availability").select("id, weekday, start_time, end_time, starts_at, ends_at, is_available, note").order("created_at");
  const weekly = (rows ?? []).filter((row) => row.weekday != null);
  const exceptions = (rows ?? []).filter((row) => row.starts_at);

  return (
    <AppShell ctx={ctx} title="Worker" nav={[{ href: "/worker/profile", label: "Profile", ready: true }, { href: "/worker/availability", label: "Availability", ready: true }, { href: "/worker/credentials", label: "Credentials", ready: true }]}>
      <Notice code={sp.notice} tone="info" messages={PROFILE_MESSAGES} />
      <Notice code={sp.error} messages={PROFILE_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Availability</h1>
      <p className="mt-1 text-sm text-slate-600">Weekly windows use Pacific time. Date exceptions cover extra days or blackouts, including overnight when the end time is earlier than the start.</p>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Weekly</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {weekly.length === 0 && <li className="py-2 text-sm text-slate-600">No weekly windows.</li>}
          {weekly.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {weekdayName(row.weekday)} {clock(row.start_time)}–{clock(row.end_time)}
                {row.end_time && row.start_time && row.end_time <= row.start_time ? " (overnight)" : ""}
              </span>
              <form action={removeAvailability}>
                <input type="hidden" name="id" value={row.id} />
                <button type="submit" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-800 underline">
                  Remove {weekdayName(row.weekday)} {clock(row.start_time)}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addWeeklyWindow} className="mt-3 grid gap-3">
          <label className="text-sm font-medium text-slate-800">
            Weekday
            <select name="weekday" className={fieldClass} defaultValue="1">
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-800">
            Weekly start
            <input name="startTime" type="time" required defaultValue="09:00" className={fieldClass} />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Weekly end
            <input name="endTime" type="time" required defaultValue="17:00" className={fieldClass} />
          </label>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
            Add weekly window
          </button>
        </form>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Date exceptions</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {exceptions.length === 0 && <li className="py-2 text-sm text-slate-600">No date exceptions.</li>}
          {exceptions.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {row.is_available ? "Available" : "Not available"} {formatPacific(row.starts_at)} – {formatPacific(row.ends_at)}
                {row.note ? ` · ${row.note}` : ""}
              </span>
              <form action={removeAvailability}>
                <input type="hidden" name="id" value={row.id} />
                <button type="submit" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-800 underline">
                  Remove exception
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addDateException} className="mt-3 grid gap-3">
          <label className="text-sm font-medium text-slate-800">
            Date
            <input name="date" type="date" required className={fieldClass} />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Exception start
            <input name="startTime" type="time" required defaultValue="08:00" className={fieldClass} />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Exception end
            <input name="endTime" type="time" required defaultValue="16:00" className={fieldClass} />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Kind
            <select name="kind" className={fieldClass} defaultValue="blackout">
              <option value="blackout">Not available</option>
              <option value="available">Available</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-800">
            Note
            <input name="note" maxLength={200} className={fieldClass} />
          </label>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
            Add date exception
          </button>
        </form>
      </section>
    </AppShell>
  );
}
