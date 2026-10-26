import Link from "next/link";
import { AuthCard, Field, Notice, PrimaryButton } from "@/components/ui";
import { login } from "../actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "";
  return (
    <AuthCard title="Sign in" subtitle="Find shifts or staff your next post.">
      <Notice code={sp.error} />
      <Notice code={sp.notice} tone="info" />
      <form action={login} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <PrimaryButton>Sign in</PrimaryButton>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link className="text-slate-700 underline" href="/forgot-password">Forgot password?</Link>
        <Link className="text-slate-700 underline" href="/register">Create account</Link>
      </div>
    </AuthCard>
  );
}
