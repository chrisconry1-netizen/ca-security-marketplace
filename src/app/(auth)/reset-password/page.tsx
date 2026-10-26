import { redirect } from "next/navigation";
import { AuthCard, Field, Notice, PrimaryButton } from "@/components/ui";
import { getSessionContext } from "@/server/auth/guards";
import { updatePassword } from "../actions";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getSessionContext(); // recovery link establishes a session first
  if (!ctx) redirect("/login?error=link_invalid");
  const sp = await searchParams;
  return (
    <AuthCard title="Choose a new password">
      <Notice code={sp.error} />
      <form action={updatePassword} className="space-y-4">
        <Field label="New password" name="password" type="password" autoComplete="new-password" required minLength={12} />
        <Field label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} />
        <PrimaryButton>Update password</PrimaryButton>
      </form>
    </AuthCard>
  );
}
