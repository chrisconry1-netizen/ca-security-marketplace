"use client";

import { useState } from "react";

export function ShareJobButton({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}${path}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // The user dismissed the sheet. Fall through to copy when it was not a share.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" onClick={share} className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900">
      {copied ? "Link copied" : "Share shift"}
    </button>
  );
}
