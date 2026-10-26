import Link from "next/link";
import { AuthCard, Field, Notice, PrimaryButton } from "@/components/ui";
import { register } from "../actions";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <AuthCard title="Create your account" subtitle="You'll choose worker or employer after verifying your email.">
      <Notice code={sp.error} />
      <form action={register} className="space-y-4">
        <Field label="Full name" name="displayName" autoComplete="name" required maxLength={80} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={12} />
        <p className="-mt-2 text-xs text-slate-500">At least 12 characters with upper- and lowercase letters and a number.</p>
        <Field label="Confirm password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} />
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="acceptTerms" className="mt-1 h-4 w-4" required />
          <span>I agree to the Terms of Service and Privacy Policy (drafts pending legal review).</span>
        </label>
        <PrimaryButton>Create account</PrimaryButton>
      </form>
      <p className="mt-4 text-sm text-slate-700">
        Already have an account? <Link className="underline" href="/login">Sign in</Link>
      </p>
    </AuthCard>
  );
}
