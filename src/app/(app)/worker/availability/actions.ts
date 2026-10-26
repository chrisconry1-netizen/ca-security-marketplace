"use server";

import { redirect } from "next/navigation";
import { emptyToNull, formString } from "@/lib/form";
import { createClient } from "@/lib/supabase/server";
import { zonedTimeToUtc } from "@/lib/workers/time";
import { availabilityExceptionSchema, availabilityWindowSchema } from "@/lib/workers/validation";
import { requireArea } from "@/server/auth/guards";

const LIMIT = 64;

async function assertRoom(userId: string) {
  const supabase = await createClient();
  const { count } = await supabase.from("worker_availability").select("id", { count: "exact", head: true }).eq("worker_id", userId);
  if ((count ?? 0) >= LIMIT) redirect("/worker/availability?error=availability_limit");
  return supabase;
}

export async function addWeeklyWindow(fd: FormData) {
  const ctx = await requireArea("worker");
  const parsed = availabilityWindowSchema.safeParse({
    weekday: formString(fd, "weekday"),
    startTime: formString(fd, "startTime"),
    endTime: formString(fd, "endTime"),
  });
  if (!parsed.success) redirect("/worker/availability?error=availability_invalid");
  const supabase = await assertRoom(ctx.userId);
  const { error } = await supabase.from("worker_availability").insert({
    worker_id: ctx.userId,
    weekday: parsed.data.weekday,
    start_time: parsed.data.startTime,
    end_time: parsed.data.endTime,
    is_available: true,
  });
  if (error) {
    console.error("availability.window_failed", error.code);
    redirect("/worker/availability?error=availability_invalid");
  }
  redirect("/worker/availability?notice=availability_saved");
}

export async function addDateException(fd: FormData) {
  const ctx = await requireArea("worker");
  const parsed = availabilityExceptionSchema.safeParse({
    date: formString(fd, "date"),
    startTime: formString(fd, "startTime"),
    endTime: formString(fd, "endTime"),
    kind: formString(fd, "kind"),
    note: formString(fd, "note"),
  });
  if (!parsed.success) redirect("/worker/availability?error=availability_invalid");
  let ends = zonedTimeToUtc(parsed.data.date, parsed.data.endTime);
  const starts = zonedTimeToUtc(parsed.data.date, parsed.data.startTime);
  if (ends <= starts) ends = new Date(ends.getTime() + 24 * 60 * 60 * 1000);
  if (!(ends > starts)) redirect("/worker/availability?error=availability_invalid");
  const supabase = await assertRoom(ctx.userId);
  const { error } = await supabase.from("worker_availability").insert({
    worker_id: ctx.userId,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    is_available: parsed.data.kind === "available",
    note: emptyToNull(parsed.data.note),
  });
  if (error) {
    console.error("availability.exception_failed", error.code);
    redirect("/worker/availability?error=availability_invalid");
  }
  redirect("/worker/availability?notice=availability_saved");
}

export async function removeAvailability(fd: FormData) {
  const ctx = await requireArea("worker");
  const id = formString(fd, "id");
  if (!id) redirect("/worker/availability?error=availability_invalid");
  const supabase = await createClient();
  const { error } = await supabase.from("worker_availability").delete().eq("id", id).eq("worker_id", ctx.userId);
  if (error) redirect("/worker/availability?error=generic");
  redirect("/worker/availability?notice=removed");
}
