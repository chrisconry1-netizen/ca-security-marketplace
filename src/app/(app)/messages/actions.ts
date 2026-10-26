"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { formString } from "@/lib/form";
import { REPORT_REASONS, type ReportReason } from "@/lib/messaging/limits";
import { messagingErrorCode } from "@/lib/messaging/messages";
import { messageDraftError } from "@/lib/messaging/validation";
import { requireMessagingUser } from "@/lib/messaging/access";
import { createClient } from "@/lib/supabase/server";
import { requestMeta } from "@/server/audit/audit";
import { uploadMessageAttachment } from "@/server/storage/uploads";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(path: string, code: string): never {
  const joiner = path.includes("?") ? "&" : "?";
  redirect(`${path}${joiner}error=${code}`);
}

function uuidOrNull(value: string): string | null {
  return UUID.test(value) ? value : null;
}

export async function openConversation(fd: FormData) {
  await requireMessagingUser(safeNextPath(formString(fd, "returnTo"), "/messages"));
  const returnTo = safeNextPath(formString(fd, "returnTo"), "/messages");
  const applicationId = uuidOrNull(formString(fd, "applicationId"));
  const organizationId = uuidOrNull(formString(fd, "organizationId"));
  const workerId = uuidOrNull(formString(fd, "workerId"));
  if (!applicationId && (!organizationId || !workerId)) fail(returnTo, "invalid_input");

  const supabase = await createClient();
  const meta = await requestMeta();
  const { data, error } = await supabase.rpc("open_conversation", {
    p_organization_id: organizationId,
    p_worker_id: workerId,
    p_application_id: applicationId,
    p_user_agent: meta.user_agent,
    p_request_id: meta.request_id,
    p_ip: meta.ip_address,
  });
  if (error || typeof data !== "string") fail(returnTo, messagingErrorCode(error?.message));
  redirect(`/messages/${data}`);
}

export async function sendMessage(fd: FormData) {
  const ctx = await requireMessagingUser();
  const conversationId = uuidOrNull(formString(fd, "conversationId"));
  const thread = conversationId ? `/messages/${conversationId}` : "/messages";
  if (!conversationId) fail("/messages", "invalid_input");

  const jobId = uuidOrNull(formString(fd, "jobId"));
  const body = formString(fd, "body");
  const files = fd.getAll("file").filter((value): value is File => value instanceof File && value.size > 0);
  const draftError = messageDraftError(body, { attachmentCount: jobId ? 0 : files.length, jobCard: Boolean(jobId) });
  if (draftError) fail(thread, draftError);

  const supabase = await createClient();
  const attachments: { storage_path: string; mime_type: string; size_bytes: number }[] = [];
  if (!jobId) {
    for (const file of files) {
      const uploaded = await uploadMessageAttachment(supabase, conversationId, ctx.userId, file);
      if (!uploaded) fail(thread, "attachment_invalid");
      attachments.push(uploaded);
    }
  }

  const { error } = await supabase.rpc("send_message", {
    p_conversation: conversationId,
    p_body: body,
    p_job_id: jobId,
    p_attachments: attachments,
  });
  if (error) fail(thread, messagingErrorCode(error.message));
  redirect(thread);
}

export async function setArchived(fd: FormData) {
  const ctx = await requireMessagingUser();
  const conversationId = uuidOrNull(formString(fd, "conversationId"));
  const archived = formString(fd, "archived") === "1";
  const thread = conversationId ? `/messages/${conversationId}` : "/messages";
  if (!conversationId) fail("/messages", "invalid_input");
  const supabase = await createClient();
  const { error } = await supabase
    .from("conversation_members")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("conversation_id", conversationId)
    .eq("user_id", ctx.userId);
  if (error) fail(thread, messagingErrorCode(error.message));
  redirect(archived ? "/messages?notice=archived" : `${thread}?notice=unarchived`);
}

export async function blockUser(fd: FormData) {
  const ctx = await requireMessagingUser();
  const conversationId = uuidOrNull(formString(fd, "conversationId"));
  const blockedId = uuidOrNull(formString(fd, "blockedId"));
  const thread = conversationId ? `/messages/${conversationId}` : "/messages";
  if (!conversationId || !blockedId || blockedId === ctx.userId) fail(thread, "invalid_input");
  if (formString(fd, "confirm") !== "yes") fail(thread, "invalid_input");
  const supabase = await createClient();
  const { error } = await supabase.from("user_blocks").insert({ blocker_id: ctx.userId, blocked_id: blockedId });
  if (error && error.code !== "23505") fail(thread, messagingErrorCode(error.message));
  redirect(`${thread}?notice=blocked_user`);
}

export async function unblockUser(fd: FormData) {
  const ctx = await requireMessagingUser();
  const conversationId = uuidOrNull(formString(fd, "conversationId"));
  const blockedId = uuidOrNull(formString(fd, "blockedId"));
  const thread = conversationId ? `/messages/${conversationId}` : "/messages";
  if (!conversationId || !blockedId) fail(thread, "invalid_input");
  const supabase = await createClient();
  const { error } = await supabase.from("user_blocks").delete().eq("blocker_id", ctx.userId).eq("blocked_id", blockedId);
  if (error) fail(thread, messagingErrorCode(error.message));
  redirect(`${thread}?notice=unblocked_user`);
}

export async function reportTarget(fd: FormData) {
  const ctx = await requireMessagingUser();
  const conversationId = uuidOrNull(formString(fd, "conversationId"));
  const targetId = uuidOrNull(formString(fd, "targetId"));
  const targetType = formString(fd, "targetType");
  const reason = formString(fd, "reason");
  const details = formString(fd, "details").trim();
  const thread = conversationId ? `/messages/${conversationId}` : "/messages";
  if (!conversationId || !targetId) fail(thread, "invalid_input");
  if (targetType !== "message" && targetType !== "conversation") fail(thread, "invalid_input");
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) fail(thread, "invalid_input");
  if (details.length > 4000) fail(thread, "invalid_input");

  const supabase = await createClient();
  const { error } = await supabase.from("reports").insert({
    reporter_id: ctx.userId,
    target_type: targetType,
    target_id: targetId,
    reason: reason as ReportReason,
    details: details || null,
    status: "open",
  });
  if (error) fail(thread, messagingErrorCode(error.message));
  redirect(`${thread}?notice=reported`);
}
