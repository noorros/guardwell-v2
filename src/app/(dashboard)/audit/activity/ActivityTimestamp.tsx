// src/app/(dashboard)/audit/activity/ActivityTimestamp.tsx
//
// Browser-TZ timestamp via useSyncExternalStore so server + client
// hydrate cleanly (mirror the AdoptedBadge pattern from /programs/policies).

"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

function getSnapshot() {
  return Date.now();
}

function getServerSnapshot() {
  return null;
}

export function ActivityTimestamp({ iso }: { iso: string }) {
  const now = useSyncExternalStore<number | null>(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const date = new Date(iso);
  const label =
    now != null ? formatRelative(now - date.getTime()) : date.toISOString().slice(0, 16).replace("T", " ");
  return (
    <time
      dateTime={iso}
      suppressHydrationWarning
      className="block text-[11px] font-medium tabular-nums text-foreground"
      title={date.toISOString()}
    >
      {label}
    </time>
  );
}

function formatRelative(diffMs: number): string {
  if (diffMs < 0) return "in the future";
  if (diffMs < 30_000) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
