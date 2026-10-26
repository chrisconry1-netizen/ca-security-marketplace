import Link from "next/link";
import { AuthCard, Notice } from "@/components/ui";
export default function Forbidden() {
  return (
    <AuthCard title="Access denied">
      <Notice code="forbidden" />
      <Link href="/dashboard" className="text-sm underline">Go to my dashboard</Link>
    </AuthCard>
  );
}
