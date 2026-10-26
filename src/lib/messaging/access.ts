import "server-only";
import { redirect } from "next/navigation";
import { EMPLOYER_ROLES, STAFF_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { employerNav } from "@/lib/employer/nav";
import { workerNav } from "@/lib/nav";
import { requireUser, type SessionContext } from "@/server/auth/guards";

export function messagingChrome(ctx: SessionContext): { title: string; nav: { href: string; label: string; ready?: boolean }[] } {
  if (ctx.profile.account_type === "worker") return { title: "Worker", nav: workerNav };
  if (ctx.profile.account_type === "employer" || hasAnyRole(ctx.roles, EMPLOYER_ROLES)) return { title: "Employer", nav: employerNav };
  return { title: "Messages", nav: [{ href: "/messages", label: "Messages", ready: true }] };
}

export async function requireMessagingUser(nextPath = "/messages"): Promise<SessionContext> {
  const ctx = await requireUser(nextPath);
  if (ctx.profile.account_type === null && !hasAnyRole(ctx.roles, STAFF_ROLES)) redirect("/account-type");
  return ctx;
}
