import { AuthCard, Field, Notice, PrimaryButton } from "@/components/ui";
import { requestPasswordReset } from "../actions";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a secure link.">
      <Notice code={sp.error} />
      <Notice code={sp.notice} tone="info" />
      <form action={requestPasswordReset} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <PrimaryButton>Send reset link</PrimaryButton>
      </form>
    </AuthCard>
  );
}
