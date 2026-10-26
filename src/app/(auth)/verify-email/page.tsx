import Link from "next/link";
import { AuthCard } from "@/components/ui";

export default function VerifyEmailPage() {
  return (
    <AuthCard title="Check your email" subtitle="We sent a verification link. Open it on this device to continue.">
      <p className="text-sm text-slate-700">Didn&apos;t get it? Check spam, or try signing in again in a minute.</p>
      <Link href="/login" className="mt-6 inline-block text-sm underline">Back to sign in</Link>
    </AuthCard>
  );
}
