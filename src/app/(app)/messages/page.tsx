import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { InboxLive } from "@/components/messages/inbox-live";
import { Notice } from "@/components/ui";
import { queryValue } from "@/lib/form";
import { messagingChrome, requireMessagingUser } from "@/lib/messaging/access";
import { MESSAGING_MESSAGES } from "@/lib/messaging/messages";
import { normalizeSearchQuery } from "@/lib/messaging/validation";
import { createClient } from "@/lib/supabase/server";

interface InboxRow {
  conversation_id: string;
  counterpart_name: string | null;
  job_title: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  origin: string | null;
}

function when(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireMessagingUser();
  const sp = await searchParams;
  const archived = queryValue(sp.archived) === "1";
  const search = normalizeSearchQuery(queryValue(sp.q));
  const chrome = messagingChrome(ctx);
  const supabase = await createClient();
  const inbox = search.error
    ? { data: [] as InboxRow[], error: null }
    : await supabase.rpc("my_inbox", { p_query: search.query, p_archived: archived });
  const rows = (inbox.data ?? []) as InboxRow[];

  return (
    <AppShell ctx={ctx} title={chrome.title} nav={chrome.nav}>
      <Notice code={queryValue(sp.notice)} tone="info" messages={MESSAGING_MESSAGES} />
      <Notice code={search.error ?? queryValue(sp.error)} messages={MESSAGING_MESSAGES} />
      <h1 className="mt-2 text-2xl font-bold text-slate-900">{archived ? "Archived" : "Messages"}</h1>
      <p className="mt-1 text-sm text-slate-600">Search looks through your conversations only. GuardGig does not employ the worker.</p>
      <form method="get" className="mt-4 flex gap-2">
        {archived && <input type="hidden" name="archived" value="1" />}
        <label className="sr-only" htmlFor="q">
          Search conversations
        </label>
        <input
          id="q"
          name="q"
          defaultValue={queryValue(sp.q)}
          maxLength={80}
          placeholder="Search your messages"
          className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3 text-base"
        />
        <button type="submit" className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">
          Search
        </button>
      </form>
      <p className="mt-3 text-sm">
        {archived ? (
          <Link href="/messages" className="font-semibold underline">
            Inbox
          </Link>
        ) : (
          <Link href="/messages?archived=1" className="font-semibold underline">
            Archived
          </Link>
        )}
      </p>
      {inbox.error && <p className="mt-4 text-sm text-red-800">Messages could not be loaded.</p>}
      <InboxLive userId={ctx.userId}>
        <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {rows.length === 0 && !inbox.error && <li className="p-4 text-sm text-slate-600">No conversations here.</li>}
          {rows.map((row) => (
            <li key={row.conversation_id}>
              <Link href={`/messages/${row.conversation_id}`} className="block p-4">
                <span className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-slate-900">{row.counterpart_name || "Conversation"}</span>
                  {row.unread_count > 0 && (
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">{row.unread_count} unread</span>
                  )}
                </span>
                <span className="mt-1 block text-sm text-slate-700">{row.last_message_preview || "No messages yet"}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {[row.job_title, row.origin, when(row.last_message_at)].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </InboxLive>
    </AppShell>
  );
}
