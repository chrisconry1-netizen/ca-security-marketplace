import Link from "next/link";
import type { ReactNode } from "react";
import { authMessage } from "@/lib/auth/validation";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh flex items-start sm:items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl sm:p-8">
        <Link href="/" className="text-sm font-semibold tracking-wide text-slate-500">
          CA SECURITY WORKFORCE
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function Notice({ code, tone = "error" }: { code?: string | string[]; tone?: "error" | "info" }) {
  const msg = authMessage(Array.isArray(code) ? code[0] : code);
  if (!msg) return null;
  const cls = tone === "error" ? "bg-red-50 text-red-800 border-red-200" : "bg-emerald-50 text-emerald-800 border-emerald-200";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mb-4 rounded-lg border px-3 py-2 text-sm ${cls}`}>
      {msg}
    </p>
  );
}

export function Field(props: { label: string; name: string; type?: string; autoComplete?: string; required?: boolean; minLength?: number; maxLength?: number }) {
  const { label, name, type = "text", ...rest } = props;
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      <input
        id={name}
        name={name}
        type={type}
        {...rest}
        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-3 text-base text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
      />
    </label>
  );
}

export function PrimaryButton({ children, name, value }: { children: ReactNode; name?: string; value?: string }) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/40"
    >
      {children}
    </button>
  );
}
