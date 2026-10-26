import { SECURITY_CATEGORIES } from "@/lib/workers/categories";
import { JOB_TYPES, SHIFT_PERIODS } from "@/lib/jobs/constants";
import type { JobSearchInput } from "@/lib/jobs/search-params";
import { fieldClass } from "@/components/status-badge";

export function JobFilters({
  action,
  input,
  credentials,
  showEligible,
}: {
  action: string;
  input: JobSearchInput;
  credentials: { code: string; name: string }[];
  showEligible: boolean;
}) {
  return (
    <form action={action} method="get" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      {showEligible && (
        <>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-slate-900">
            <input type="checkbox" name="eligible" value="1" defaultChecked={input.eligible} className="h-5 w-5" />
            Eligible for me
          </label>
          <p className="text-xs text-slate-500">Eligible uses your verified credentials only. Pending, rejected, and expired credentials do not count.</p>
        </>
      )}
      <label className="block text-sm font-medium text-slate-800">
        City on the shift
        <input name="city" defaultValue={input.city} className={fieldClass} autoComplete="address-level2" />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Near city or ZIP
        <input name="near" defaultValue={input.near} placeholder="Oakland or 94612" className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Within miles
        <input name="radius" inputMode="numeric" defaultValue={input.radius} className={fieldClass} />
      </label>
      <details>
        <summary className="cursor-pointer py-2 text-sm font-semibold text-slate-900">More filters</summary>
        <div className="mt-3 space-y-3">
          <label className="block text-sm font-medium text-slate-800">
            County
            <input name="county" defaultValue={input.county} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Minimum pay ($ / hour floor)
            <input name="pay" inputMode="decimal" defaultValue={input.pay} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Date
            <input type="date" name="date" defaultValue={input.date} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Shift
            <select name="shift" defaultValue={input.shift} className={fieldClass}>
              <option value="">Any</option>
              {SHIFT_PERIODS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm font-medium text-slate-800">
              Starts after
              <input type="time" name="from" defaultValue={input.from} className={fieldClass} />
            </label>
            <label className="block text-sm font-medium text-slate-800">
              Starts before
              <input type="time" name="to" defaultValue={input.to} className={fieldClass} />
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-800">
            Category
            <select name="category" defaultValue={input.category} className={fieldClass}>
              <option value="">Any</option>
              {SECURITY_CATEGORIES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Armed
            <select name="armed" defaultValue={input.armed} className={fieldClass}>
              <option value="">Any</option>
              <option value="no">Unarmed</option>
              <option value="yes">Armed</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Requires credential
            <select name="credential" defaultValue={input.credential} className={fieldClass}>
              <option value="">Any</option>
              {credentials.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-800">
            I have at least this many years
            <input name="years" inputMode="numeric" defaultValue={input.years} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Employer
            <input name="employer" defaultValue={input.employer} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Job type
            <select name="jobType" defaultValue={input.jobType} className={fieldClass}>
              <option value="">Any</option>
              {JOB_TYPES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      <button type="submit" className="min-h-11 w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
        Show shifts
      </button>
    </form>
  );
}
