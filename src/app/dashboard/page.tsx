import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { homePathFor } from "@/lib/auth/roles";

export default async function DashboardRouter() {
  const ctx = await requireUser("/dashboard");
  redirect(homePathFor(ctx.profile, ctx.roles));
}
