import { fieldClass } from "@/components/status-badge";
import { ORG_TYPES } from "@/lib/orgs/constants";

export interface OrgFormDefaults {
  name?: string;
  orgType?: string;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  description?: string;
  serviceCounties?: string;
  licenseType?: string;
  licenseNumber?: string;
  logoPath?: string | null;
}

export function OrgForm({
  action,
  organizationId,
  defaults = {},
}: {
  action: (fd: FormData) => Promise<void>;
  organizationId?: string;
  defaults?: OrgFormDefaults;
}) {
  return (
    <form action={action} className="mt-4 space-y-4">
      {organizationId && <input type="hidden" name="organizationId" value={organizationId} />}
      {defaults.logoPath && <input type="hidden" name="currentLogo" value={defaults.logoPath} />}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-800">
          Organization name
          <input name="name" required minLength={1} maxLength={200} defaultValue={defaults.name ?? ""} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Organization type
          <select name="orgType" defaultValue={defaults.orgType ?? "ppo"} className={fieldClass}>
            {ORG_TYPES.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Website
          <input name="website" type="url" inputMode="url" maxLength={200} placeholder="https://" defaultValue={defaults.website ?? ""} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Contact email
          <input name="contactEmail" type="email" maxLength={200} defaultValue={defaults.contactEmail ?? ""} autoComplete="email" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Contact phone
          <input name="contactPhone" type="tel" inputMode="tel" placeholder="+14155550100" defaultValue={defaults.contactPhone ?? ""} autoComplete="tel" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Description
          <textarea name="description" maxLength={5000} rows={4} defaultValue={defaults.description ?? ""} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Service counties
          <textarea name="serviceCounties" maxLength={4000} rows={3} defaultValue={defaults.serviceCounties ?? ""} placeholder="Alameda" className={fieldClass} />
        </label>
        <p className="text-xs text-slate-500">One county per line, or separate them with commas.</p>
      </section>
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">License</h2>
        <p className="text-sm text-slate-600">Enter the number as it appears on the license. GuardGig stores it as submitted and does not check it with BSIS. PPO, PPO branch, and proprietary private security employers need a number and a contact email before verification can be requested.</p>
        <label className="block text-sm font-medium text-slate-800">
          License type
          <input name="licenseType" maxLength={80} defaultValue={defaults.licenseType ?? ""} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          License number
          <input name="licenseNumber" maxLength={40} defaultValue={defaults.licenseNumber ?? ""} className={fieldClass} />
        </label>
      </section>
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Logo</h2>
        <label className="block text-sm font-medium text-slate-800">
          Logo file
          <input name="logo" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-sm" />
        </label>
        {defaults.logoPath && (
          <label className="flex items-center gap-3 text-sm font-medium text-slate-800">
            <input name="clearLogo" value="yes" type="checkbox" className="h-5 w-5" />
            Remove the current logo
          </label>
        )}
      </section>
      <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white">
        Save organization
      </button>
    </form>
  );
}
