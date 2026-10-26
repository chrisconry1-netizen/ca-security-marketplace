import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/(auth)/actions";
import { PRODUCT_NAME } from "@/lib/brand";
import type { SessionContext } from "@/server/auth/guards";

export function AppShell({ ctx, title, nav, children }: { ctx: SessionContext; title: string; nav: { href: string; label: string; ready?: boolean }[]; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className="font-bold text-slate-900">{PRODUCT_NAME}</Link>
          <span className="text-sm font-medium text-slate-500">{title}</span>
          <form action={logout}>
            <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">
              Sign out
            </button>
          </form>
        </div>
        <nav aria-label="Section" className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 pb-3">
          {nav.map((n) =>
            n.ready ? (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-sm font-medium text-white">
                {n.label}
              </Link>
            ) : (
              <span key={n.href} className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-500" title="Coming in a later phase">
                {n.label}
              </span>
            ),
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <p className="text-sm text-slate-500">Signed in as {ctx.displayName} · roles: {ctx.roles.join(", ") || "none"}</p>
        {children}
      </main>
    </div>
  );
}

export function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
    </section>
  );
}
