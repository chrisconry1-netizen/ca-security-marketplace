import { AuthCard } from "@/components/ui";
import { logout } from "../(auth)/actions";
export default function AccountInactive() {
  return (
    <AuthCard title="Account unavailable" subtitle="This account is suspended or deactivated. Contact support if you believe this is a mistake.">
      <form action={logout}><button className="text-sm underline" type="submit">Sign out</button></form>
    </AuthCard>
  );
}
