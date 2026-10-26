import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ThreadLive } from "@/components/messages/thread-live";
import { Notice } from "@/components/ui";
import { blockUser, reportTarget, sendMessage, setArchived, unblockUser } from "@/app/(app)/messages/actions";
import { queryValue } from "@/lib/form";
import { PUBLIC_JOB_COLUMNS, HIRING_DISCLAIMER } from "@/lib/jobs/constants";
import { embedded, formatJobPay, formatShiftWhen } from "@/lib/jobs/present";
import { REPORT_REASON_LABELS, REPORT_REASONS } from "@/lib/messaging/limits";
import { messagingChrome, requireMessagingUser } from "@/lib/messaging/access";
import { MESSAGING_MESSAGES } from "@/lib/messaging/messages";
import { createClient } from "@/lib/supabase/server";
import { signMessageAttachment } from "@/server/storage/signed-urls";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MessageRow {
  id: string;
  sender_id: string | null;
  kind: string;
  body: string | null;
  job_id: string | null;
  created_at: string;
  voice_duration_ms: number | null;
  voice_codec: string | null;
}

interface AttachmentRow {
  id: string;
  message_id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
}

interface MemberCard {
  user_id: string;
  display_name: string;
  last_read_at: string | null;
  left_at: string | null;
  is_worker: boolean;
}

interface JobCard {
  id: string;
  title: string;
  city: string | null;
  county: string | null;
  pay_type: string;
  pay_min_cents: number | null;
  pay_max_cents: number | null;
  starts_at: string | null;
  ends_at: string | null;
  shift_period: string | null;
  organizations: { name: string } | { name: string }[] | null;
}

function when(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireMessagingUser(`/messages/${id}`);
  const sp = await searchParams;
  const chrome = messagingChrome(ctx);
  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, job_id, worker_id, organization_id, origin, application_id")
    .eq("id", id)
    .maybeSingle();
  if (!conversation) notFound();

  const [{ data: messageRows }, { data: attachmentRows }, { data: memberRows }, { data: blocks }] = await Promise.all([
    supabase
      .from("messages")
      .select("id, sender_id, kind, body, job_id, created_at, voice_duration_ms, voice_codec")
      .eq("conversation_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase.from("message_attachments").select("id, message_id, storage_path, mime_type, size_bytes").eq("conversation_id", id),
    supabase.rpc("conversation_member_cards", { p_conversation: id }),
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id", ctx.userId),
  ]);
  await supabase.rpc("mark_conversation_read", { p_conversation: id });

  const messages = (messageRows ?? []) as MessageRow[];
  const attachments = (attachmentRows ?? []) as AttachmentRow[];
  const members = (memberRows ?? []) as MemberCard[];
  const blockedIds = new Set((blocks ?? []).map((row) => row.blocked_id as string));
  const activeMembers = members.filter((member) => !member.left_at);
  const names = new Map(members.map((member) => [member.user_id, member.display_name]));
  const otherActive = activeMembers.filter((member) => member.user_id !== ctx.userId);
  const sendDisabled = otherActive.some((member) => blockedIds.has(member.user_id));
  const readAt = otherActive.reduce<string | null>((latest, member) => {
    if (!member.last_read_at) return latest;
    if (!latest || member.last_read_at > latest) return member.last_read_at;
    return latest;
  }, null);
  const ownLast = [...messages].reverse().find((message) => message.sender_id === ctx.userId);

  const jobIds = [...new Set(messages.flatMap((message) => (message.job_id ? [message.job_id] : [])))];
  const { data: jobRows } = jobIds.length
    ? await supabase.from("jobs").select(`${PUBLIC_JOB_COLUMNS}, organizations(name)`).in("id", jobIds)
    : { data: [] };
  const jobs = new Map(((jobRows ?? []) as unknown as JobCard[]).map((job) => [job.id, job]));

  const signed = new Map<string, string | null>();
  for (const attachment of attachments) {
    signed.set(attachment.id, await signMessageAttachment(attachment.storage_path, id));
  }

  const counterpart = otherActive.find((member) => member.is_worker)?.display_name
    ?? otherActive[0]?.display_name
    ?? "Conversation";

  return (
    <AppShell ctx={ctx} title={chrome.title} nav={chrome.nav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={MESSAGING_MESSAGES} />
      <Notice code={queryValue(sp.error)} messages={MESSAGING_MESSAGES} />
      <p className="text-sm">
        <Link href="/messages" className="font-semibold underline">
          Inbox
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">{counterpart}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {activeMembers.map((member) => member.display_name).join(", ")}
        {conversation.origin ? ` · ${conversation.origin}` : ""}
      </p>
      <p className="mt-2 text-sm text-slate-600">{HIRING_DISCLAIMER}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={setArchived}>
          <input type="hidden" name="conversationId" value={id} />
          <input type="hidden" name="archived" value="1" />
          <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
            Archive
          </button>
        </form>
        {otherActive.map((member) =>
          blockedIds.has(member.user_id) ? (
            <form key={member.user_id} action={unblockUser}>
              <input type="hidden" name="conversationId" value={id} />
              <input type="hidden" name="blockedId" value={member.user_id} />
              <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
                Unblock {member.display_name}
              </button>
            </form>
          ) : (
            <details key={member.user_id} className="rounded-lg border border-slate-200 p-2">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">Block {member.display_name}</summary>
              <form action={blockUser} className="mt-2">
                <input type="hidden" name="conversationId" value={id} />
                <input type="hidden" name="blockedId" value={member.user_id} />
                <p className="text-xs text-slate-600">They cannot send in threads you share. You can still read this thread and report it.</p>
                <button type="submit" name="confirm" value="yes" className="mt-1 min-h-11 text-sm font-semibold text-slate-900 underline">
                  Confirm block
                </button>
              </form>
            </details>
          ),
        )}
      </div>
      <form action={reportTarget} className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <input type="hidden" name="conversationId" value={id} />
        <input type="hidden" name="targetType" value="conversation" />
        <input type="hidden" name="targetId" value={id} />
        <label className="block text-sm font-medium text-slate-800">
          Report this conversation
          <select name="reason" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" defaultValue="harassment">
            {REPORT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {REPORT_REASON_LABELS[reason]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Details
          <textarea name="details" maxLength={4000} rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
        </label>
        <button type="submit" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
          Submit report
        </button>
        <p className="text-xs text-slate-500">A person reviews this. Reporting does not hide or delete the message.</p>
      </form>
      <ThreadLive conversationId={id} userId={ctx.userId} memberIds={activeMembers.map((member) => member.user_id)} sendDisabled={sendDisabled}>
        <div aria-live="polite" className="mt-4 space-y-3">
          {messages.length === 0 && <p className="text-sm text-slate-600">No messages yet.</p>}
          {messages.map((message) => {
            const mine = message.sender_id === ctx.userId;
            const job = message.job_id ? jobs.get(message.job_id) : undefined;
            const files = attachments.filter((attachment) => attachment.message_id === message.id);
            const read = mine && ownLast?.id === message.id && readAt != null && readAt >= message.created_at;
            return (
              <article key={message.id} className={`rounded-2xl border p-3 ${mine ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"}`}>
                <p className={`text-xs ${mine ? "text-slate-200" : "text-slate-500"}`}>
                  {mine ? "You" : names.get(message.sender_id ?? "") || "Member"} · {when(message.created_at)}
                  {read ? " · Read" : ""}
                </p>
                {message.kind === "voice" ? (
                  <p className="mt-1 text-sm">Voice messages aren&apos;t available yet.</p>
                ) : (
                  message.body && <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
                )}
                {message.kind === "job_card" && (
                  <div className={`mt-2 rounded-xl p-3 text-sm ${mine ? "bg-white text-slate-900" : "bg-slate-50 text-slate-900"}`}>
                    {job ? (
                      <>
                        <p className="font-semibold">{job.title}</p>
                        <p>{formatJobPay(job.pay_type, job.pay_min_cents, job.pay_max_cents)}</p>
                        <p>{formatShiftWhen(job.starts_at, job.ends_at, job.shift_period)}</p>
                        <p>{[job.city, job.county, embedded(job.organizations)?.name].filter(Boolean).join(" · ")}</p>
                        <Link href={`/jobs/${job.id}`} className="mt-1 inline-block font-semibold underline">
                          View shift
                        </Link>
                      </>
                    ) : (
                      <p>This shift isn&apos;t available.</p>
                    )}
                  </div>
                )}
                {files.map((file) => {
                  const url = signed.get(file.id);
                  if (!url) return <p key={file.id} className="mt-2 text-sm">Attachment unavailable.</p>;
                  if (file.mime_type.startsWith("image/")) {
                    return (
                      // Signed URLs expire in minutes and are not a configured image host.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={file.id} src={url} alt="Message attachment" width={160} height={120} className="mt-2 max-h-48 rounded-lg bg-white object-contain" />
                    );
                  }
                  return (
                    <a key={file.id} href={url} className="mt-2 inline-block text-sm font-semibold underline" rel="noreferrer">
                      Open PDF
                    </a>
                  );
                })}
                <details className="mt-2">
                  <summary className={`cursor-pointer text-xs underline ${mine ? "text-slate-200" : "text-slate-500"}`}>Report message</summary>
                  <form action={reportTarget} className="mt-2 space-y-2">
                    <input type="hidden" name="conversationId" value={id} />
                    <input type="hidden" name="targetType" value="message" />
                    <input type="hidden" name="targetId" value={message.id} />
                    <select name="reason" defaultValue="harassment" className="block w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900">
                      {REPORT_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {REPORT_REASON_LABELS[reason]}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="min-h-11 text-sm font-semibold text-slate-900 underline">
                      Submit report
                    </button>
                  </form>
                </details>
              </article>
            );
          })}
        </div>
      </ThreadLive>
      {conversation.job_id && !sendDisabled && (
        <form action={sendMessage} className="mt-3">
          <input type="hidden" name="conversationId" value={id} />
          <input type="hidden" name="jobId" value={conversation.job_id} />
          <button type="submit" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900">
            Send shift card
          </button>
        </form>
      )}
    </AppShell>
  );
}
