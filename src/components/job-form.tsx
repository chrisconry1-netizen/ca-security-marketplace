import { fieldClass } from "@/components/status-badge";
import { JOB_TYPES, PAY_TYPES, RECURRENCE_DAYS, URGENCIES } from "@/lib/jobs/constants";
import { SECURITY_CATEGORIES } from "@/lib/workers/categories";

export interface JobFormDefaults {
  title?: string;
  description?: string;
  jobType?: string;
  category?: string;
  armed?: boolean;
  urgency?: string;
  city?: string;
  county?: string;
  postalCode?: string;
  siteAddress?: string;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  recurrenceDays?: string[];
  payType?: string;
  payMin?: string;
  payMax?: string;
  workersNeeded?: number;
  minYears?: string;
  uniformNotes?: string;
  vehicleRequired?: boolean;
  offDutyLe?: boolean;
  equipmentNotes?: string;
  deadlineDate?: string;
  deadlineTime?: string;
  credentialTypeIds?: string[];
}

export function JobForm({
  action,
  organizationId,
  jobId,
  credentialTypes,
  defaults = {},
}: {
  action: (fd: FormData) => Promise<void>;
  organizationId: string;
  jobId?: string;
  credentialTypes: { id: string; name: string }[];
  defaults?: JobFormDefaults;
}) {
  const days = new Set(defaults.recurrenceDays ?? []);
  const creds = new Set(defaults.credentialTypeIds ?? []);
  return (
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      {jobId && <input type="hidden" name="jobId" value={jobId} />}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-800">
          Title
          <input name="title" required minLength={3} maxLength={140} defaultValue={defaults.title ?? ""} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Description
          <textarea name="description" required minLength={1} maxLength={10000} rows={5} defaultValue={defaults.description ?? ""} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Job type
          <select name="jobType" defaultValue={defaults.jobType ?? "single_shift"} className={fieldClass}>
            {JOB_TYPES.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Security category
          <select name="category" defaultValue={defaults.category ?? "unarmed_security"} className={fieldClass}>
            {SECURITY_CATEGORIES.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-3 text-sm font-medium text-slate-800">
          <input name="armed" value="yes" type="checkbox" defaultChecked={defaults.armed ?? false} className="mt-1 h-5 w-5" />
          <span>Armed post. GuardGig does not confirm a guard card or firearm permit.</span>
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Urgency
          <select name="urgency" defaultValue={defaults.urgency ?? "normal"} className={fieldClass}>
            {URGENCIES.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Location</h2>
        <p className="text-sm text-slate-600">City and county are the public area. Put the street address in the private field. Do not put a street in the city.</p>
        <label className="block text-sm font-medium text-slate-800">
          City
          <input name="city" maxLength={80} defaultValue={defaults.city ?? ""} autoComplete="address-level2" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          County
          <input name="county" maxLength={80} defaultValue={defaults.county ?? ""} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          ZIP code
          <input name="postalCode" inputMode="numeric" maxLength={10} defaultValue={defaults.postalCode ?? ""} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Site street address (private)
          <textarea name="siteAddress" maxLength={300} rows={2} defaultValue={defaults.siteAddress ?? ""} autoComplete="street-address" className={fieldClass} />
        </label>
        <p className="text-xs text-slate-500">Visible to your organization, moderators, people who apply, and assigned workers. It is not on the public listing.</p>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Schedule</h2>
        <p className="text-sm text-slate-600">Times are Pacific. Single shifts and multi-day posts need a start and end. Recurring posts also need days of the week. Contract, part-time, and full-time can leave the schedule open.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-800">
            Start date
            <input name="startDate" type="date" defaultValue={defaults.startDate ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Start time
            <input name="startTime" type="time" defaultValue={defaults.startTime ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            End date
            <input name="endDate" type="date" defaultValue={defaults.endDate ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            End time
            <input name="endTime" type="time" defaultValue={defaults.endTime ?? ""} className={fieldClass} />
          </label>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-slate-800">Recurring days</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {RECURRENCE_DAYS.map((day) => (
              <label key={day.code} className="flex items-center gap-2 text-sm text-slate-800">
                <input name="recurrenceDays" value={day.code} type="checkbox" defaultChecked={days.has(day.code)} className="h-5 w-5" />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-800">
            Application deadline date
            <input name="deadlineDate" type="date" defaultValue={defaults.deadlineDate ?? ""} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Deadline time
            <input name="deadlineTime" type="time" defaultValue={defaults.deadlineTime ?? ""} className={fieldClass} />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Pay</h2>
        <p className="text-sm text-slate-600">Enter the pay your organization is offering. GuardGig does not set or guarantee wages, and it does not pay workers.</p>
        <label className="block text-sm font-medium text-slate-800">
          Pay type
          <select name="payType" defaultValue={defaults.payType ?? "hourly"} className={fieldClass}>
            {PAY_TYPES.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Amount (USD)
          <input name="payMin" inputMode="decimal" defaultValue={defaults.payMin ?? ""} placeholder="32.00" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          High end, if it is a range (USD)
          <input name="payMax" inputMode="decimal" defaultValue={defaults.payMax ?? ""} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Workers needed
          <input name="workersNeeded" type="number" min={1} max={500} required defaultValue={defaults.workersNeeded ?? 1} className={fieldClass} />
        </label>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Requirements</h2>
        <p className="text-sm text-slate-600">Do not ask about conviction history. Credential boxes are requirements for the post, not a determination that anyone is eligible.</p>
        <label className="block text-sm font-medium text-slate-800">
          Minimum years of experience
          <input name="minYears" type="number" min={0} max={70} defaultValue={defaults.minYears ?? ""} className={fieldClass} />
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-slate-800">Required credentials</legend>
          <div className="mt-2 space-y-2">
            {credentialTypes.map((type) => (
              <label key={type.id} className="flex items-center gap-2 text-sm text-slate-800">
                <input name="credentialTypeIds" value={type.id} type="checkbox" defaultChecked={creds.has(type.id)} className="h-5 w-5" />
                {type.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-medium text-slate-800">
          Uniform or dress
          <textarea name="uniformNotes" maxLength={2000} rows={2} defaultValue={defaults.uniformNotes ?? ""} className={fieldClass} />
        </label>
        <label className="flex items-center gap-3 text-sm font-medium text-slate-800">
          <input name="vehicleRequired" value="yes" type="checkbox" defaultChecked={defaults.vehicleRequired ?? false} className="h-5 w-5" />
          Vehicle required
        </label>
        <label className="flex items-start gap-3 text-sm font-medium text-slate-800">
          <input name="offDutyLe" value="yes" type="checkbox" defaultChecked={defaults.offDutyLe ?? false} className="mt-0.5 h-5 w-5" />
          <span>This post requires a recorded off-duty law-enforcement approval. Suggestions use that flag. It is not a determination that anyone may work the post.</span>
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Equipment
          <textarea name="equipmentNotes" maxLength={2000} rows={2} defaultValue={defaults.equipmentNotes ?? ""} className={fieldClass} />
        </label>
      </section>

      <p className="text-sm text-slate-600">GuardGig lists this post for your organization. It does not employ or dispatch the worker. If the organization is not verified, Publish moves the job to pending review instead of the public list.</p>
      <button type="submit" name="intent" value="draft" className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-900">
        Save draft
      </button>
      <button type="submit" name="intent" value="publish" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
        Publish
      </button>
    </form>
  );
}
