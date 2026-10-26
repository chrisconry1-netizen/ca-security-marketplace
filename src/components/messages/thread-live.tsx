"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { sendMessage } from "@/app/(app)/messages/actions";
import { MESSAGE_BODY_MAX } from "@/lib/messaging/limits";
import { getBrowserClient } from "@/lib/supabase/browser";

export function ThreadLive({
  conversationId,
  userId,
  memberIds,
  sendDisabled,
  children,
}: {
  conversationId: string;
  userId: string;
  memberIds: string[];
  sendDisabled: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [typingName, setTypingName] = useState(false);
  const [live, setLive] = useState(false);
  const lastSent = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const membersKey = memberIds.join(",");

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let typingTimer = 0;
    const supabase = getBrowserClient();
    const allowed = new Set(membersKey.split(",").filter(Boolean));

    async function start() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      const next = supabase.channel(`conversation:${conversationId}`, {
        config: { private: true, broadcast: { self: false } },
      });
      channel = next;
      channelRef.current = next;
      next
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, async () => {
          await supabase.rpc("mark_conversation_read", { p_conversation: conversationId });
          router.refresh();
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversationId}` }, () => {
          router.refresh();
        })
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          const id = payload && typeof payload === "object" && "userId" in payload ? String(payload.userId) : "";
          if (!id || id === userId || !allowed.has(id)) return;
          setTypingName(true);
          window.clearTimeout(typingTimer);
          typingTimer = window.setTimeout(() => setTypingName(false), 3000);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setLive(true);
        });
    }

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(typingTimer);
      channelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [conversationId, membersKey, router, userId]);

  function announceTyping() {
    const channel = channelRef.current;
    if (!channel || sendDisabled) return;
    const now = Date.now();
    if (now - lastSent.current < 2000) return;
    lastSent.current = now;
    void channel.send({ type: "broadcast", event: "typing", payload: { userId } });
  }

  return (
    <div>
      {children}
      <p className="mt-2 min-h-5 text-sm text-slate-500" aria-live="polite">
        {live ? "Live" : ""}
        {live && typingName ? " · " : ""}
        {typingName ? "Typing…" : ""}
      </p>
      {sendDisabled ? (
        <p className="mt-3 text-sm text-slate-700">You blocked someone in this thread. Unblock them before sending.</p>
      ) : (
        <form action={sendMessage} className="mt-3 space-y-3">
          <input type="hidden" name="conversationId" value={conversationId} />
          <label className="block text-sm font-medium text-slate-800">
            Message
            <textarea
              name="body"
              rows={3}
              maxLength={MESSAGE_BODY_MAX}
              onChange={announceTyping}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-3 text-base text-slate-900"
              placeholder="Write a message"
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Attachment
            <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" multiple className="mt-1 block w-full text-sm" />
          </label>
          <p className="text-sm text-slate-600">Do not ask about conviction history. PDF, JPEG, PNG, or WebP, up to 3 files, 10 MB each.</p>
          <button type="submit" className="min-h-11 w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
            Send
          </button>
        </form>
      )}
    </div>
  );
}
