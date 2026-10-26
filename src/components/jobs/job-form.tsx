import { fieldClass } from "@/components/status-badge";
import { JOB_TYPES, ORG_TYPES, PAY_TYPES, URGENCIES, HIRING_DISCLAIMER, PAY_DISCLAIMER } from "@/lib/jobs/constants";
import { SECURITY_CATEGORIES } from "@/lib/workers/categories";
import { saveJobDraft } from "@/app/(app)/employer/jobs/actions";

export interface JobFormDefaults {
  jobId?: string;
  organizationId: string;
  title: string;
  description: string;
  jobType: string;
  category: string;
  armed: "yes" | "no";
  urgency: string;
  city: string;
  county: string;
  postalCode: string;
  siteAddress: string;
  siteLat: string;
  siteLng: string;
  approxLat: string;
  approxLng: string;
  startsLocal: string;
  endsLocal: string;
  payType: string;
  payMin: string;
  payMax: string;
  workersNeeded: string;
  minYears: string;
  uniformNotes: string;
  vehicleRequired: boolean;
  equipmentNotes: string;
  deadlineLocal: string;
  requiredCodes: string[];
  optionalCodes: string[];
}

export function JobDraftForm({
  organizations,
  types,
  defaults,
}: {
  organizations: { id: string; name: string }[];
  types: { code: string; name: string }[];
  defaults: JobFormDefaults;
}) {
  return (
    <form action={saveJobDraft} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <input type="hidden" name="jobId" value={defaults.jobId ?? ""} />
      <input type="hidden" name="returnTo" value={defaults.jobId ? `/employer/jobs/${defaults.jobId}` : "/employer/jobs/new"} />
      <p className="text-sm text-slate-600">{HIRING_DISCLAIMER}</p>
      <p className="text-sm text-slate-600">{PAY_DISCLAIMER}</p>
      {organizations.length > 1 ? (
        <label className="block text-sm font-medium text-slate-800">
          Organization
          <select name="organizationId" defaultValue={defaults.organizationId} className={fieldClass}>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="organizationId" value={defaults.organizationId} />
      )}
      <label className="block text-sm font-medium text-slate-800">
        Shift title
        <input name="title" required minLength={3} maxLength={140} defaultValue={defaults.title} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Description
        <textarea name="description" required maxLength={10000} defaultValue={defaults.description} className={`${fieldClass} min-h-28`} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Job type
        <select name="jobType" defaultValue={defaults.jobType} className={fieldClass}>
          {JOB_TYPES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Category
        <select name="category" defaultValue={defaults.category} className={fieldClass}>
          {SECURITY_CATEGORIES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Armed or unarmed
        <select name="armed" defaultValue={defaults.armed} className={fieldClass}>
          <option value="no">Unarmed</option>
          <option value="yes">Armed — verified guard card and firearm permit required</option>
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Urgency
        <select name="urgency" defaultValue={defaults.urgency} className={fieldClass}>
          {URGENCIES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">
        City
        <input name="city" defaultValue={defaults.city} autoComplete="address-level2" className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        County
        <input name="county" defaultValue={defaults.county} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        ZIP
        <input name="postalCode" defaultValue={defaults.postalCode} inputMode="numeric" autoComplete="postal-code" className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Site address (private)
        <input name="siteAddress" defaultValue={defaults.siteAddress} autoComplete="street-address" className={fieldClass} />
      </label>
      <p className="text-xs text-slate-500">Workers see the site address only after they accept an offer. The public city and ZIP stay approximate.</p>
      <details>
        <summary className="cursor-pointer py-2 text-sm font-semibold text-slate-900">Map points</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block text-sm font-medium text-slate-800">
            Private latitude
            <input name="siteLat" defaultValue={defaults.siteLat} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Private longitude
            <input name="siteLng" defaultValue={defaults.siteLng} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Approximate latitude
            <input name="approxLat" defaultValue={defaults.approxLat} className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Approximate longitude
            <input name="approxLng" defaultValue={defaults.approxLng} className={fieldClass} />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">Leave the approximate point blank to use the California city or ZIP centroid. It is rounded to about a kilometer and is never copied from the private pin.</p>
      </details>
      <label className="block text-sm font-medium text-slate-800">
        Starts (Pacific)
        <input type="datetime-local" name="startsLocal" defaultValue={defaults.startsLocal} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Ends (Pacific)
        <input type="datetime-local" name="endsLocal" defaultValue={defaults.endsLocal} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Pay type
        <select name="payType" defaultValue={defaults.payType} className={fieldClass}>
          {PAY_TYPES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Minimum pay
        <input name="payMin" inputMode="decimal" defaultValue={defaults.payMin} placeholder="28.00" className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Maximum pay
        <input name="payMax" inputMode="decimal" defaultValue={defaults.payMax} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Workers needed
        <input name="workersNeeded" inputMode="numeric" defaultValue={defaults.workersNeeded} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Minimum years
        <input name="minYears" inputMode="numeric" defaultValue={defaults.minYears} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Uniform notes
        <textarea name="uniformNotes" defaultValue={defaults.uniformNotes} className={fieldClass} />
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-slate-800">
        <input type="checkbox" name="vehicleRequired" defaultChecked={defaults.vehicleRequired} className="h-5 w-5" />
        Vehicle required
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Equipment notes
        <textarea name="equipmentNotes" defaultValue={defaults.equipmentNotes} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Application deadline (Pacific)
        <input type="datetime-local" name="deadlineLocal" defaultValue={defaults.deadlineLocal} className={fieldClass} />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-900">Required credentials</legend>
        <p className="text-xs text-slate-500">A worker cannot apply until each of these is verified and still valid on the shift date. Armed shifts also require a verified guard card and exposed firearm permit.</p>
        {types.map((type) => (
          <label key={type.code} className="flex min-h-11 items-center gap-3 text-sm text-slate-800">
            <input type="checkbox" name="requiredCodes" value={type.code} defaultChecked={defaults.requiredCodes.includes(type.code)} className="h-5 w-5" />
            {type.name}
          </label>
        ))}
      </fieldset>
      <details>
        <summary className="cursor-pointer py-2 text-sm font-semibold text-slate-900">Optional credentials</summary>
        <div className="mt-2 space-y-2">
          {types.map((type) => (
            <label key={type.code} className="flex min-h-11 items-center gap-3 text-sm text-slate-800">
              <input type="checkbox" name="optionalCodes" value={type.code} defaultChecked={defaults.optionalCodes.includes(type.code)} className="h-5 w-5" />
              Optional {type.name}
            </label>
          ))}
        </div>
      </details>
      <button type="submit" className="min-h-11 w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
        Save draft
      </button>
      <p className="text-xs text-slate-500">Organization types such as {ORG_TYPES[0]?.label} are chosen when the organization is created. Saving a draft does not publish the shift.</p>
    </form>
  );
}
