import Link from "next/link";

export default function Landing() {
  return (
    <main className="min-h-dvh bg-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="flex items-center justify-between">
          <span className="text-sm font-semibold tracking-wide text-slate-300">CA SECURITY WORKFORCE</span>
          <nav className="flex gap-3 text-sm">
            <Link href="/login" className="rounded-lg px-3 py-2 hover:bg-white/10">Sign in</Link>
            <Link href="/register" className="rounded-lg bg-white px-3 py-2 font-semibold text-slate-900">Get started</Link>
          </nav>
        </header>
        <section className="py-16 sm:py-24">
          <h1 className="text-4xl font-extrabold leading-tight sm:text-6xl">California&apos;s security shift marketplace.</h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-300">
            Verified credentials, real-time availability and fast matching for guards, armed and executive protection professionals, and the licensed companies that hire them.
          </p>
          <p className="mt-6">
            <Link href="/jobs" className="text-sm font-semibold text-white underline underline-offset-4">
              Browse open shifts
            </Link>
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Link href="/register" className="rounded-2xl bg-white p-6 text-slate-900 hover:bg-slate-100">
              <span className="block text-xl font-bold">I need security work</span>
              <span className="mt-1 block text-sm text-slate-600">Find qualified matching shifts.</span>
            </Link>
            <Link href="/register" className="rounded-2xl border border-white/30 p-6 hover:bg-white/10">
              <span className="block text-xl font-bold">I need security staff</span>
              <span className="mt-1 block text-sm text-slate-300">Find qualified, available workers.</span>
            </Link>
          </div>
        </section>
        <footer className="border-t border-white/10 py-6 text-xs text-slate-400">
          Pre-launch development build. Not affiliated with BSIS. Platform registration does not itself authorize any employment.
        </footer>
      </div>
    </main>
  );
}
