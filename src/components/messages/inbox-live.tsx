"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

export function InboxLive({ userId, children }: { userId: string; children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = getBrowserClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function start() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase.channel(`inbox:${userId}`, {
        config: { private: true, broadcast: { self: false }, presence: { enabled: false } },
      });
      channel.on("broadcast", { event: "message" }, () => {
        router.refresh();
      });
      channel.subscribe();
    }

    void start();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return <>{children}</>;
}
