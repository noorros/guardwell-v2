// src/components/gw/ConciergeConversation/ThreadList.tsx
//
// Left-rail thread list for the /concierge route. Renders the user's
// threads with:
//   - "+ New thread" link at the top (clears ?threadId search param)
//   - Each row: clickable title (inline-editable via <ThreadTitle>),
//     archive button, relative-time stamp
//   - "Show / hide archived" toggle at the bottom (toggles ?archived=true)
//
// All mutations call the server actions in
// src/app/(dashboard)/concierge/actions.ts. After a mutation we call
// router.refresh() so the server-rendered list re-fetches.
"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Archive, Plus, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  renameThreadAction,
  archiveThreadAction,
} from "@/app/(dashboard)/concierge/actions";

interface ThreadRow {
  id: string;
  title: string | null;
  lastMessageAt: Date;
  archivedAt: Date | null;
}

export interface ThreadListProps {
  threads: ThreadRow[];
  activeThreadId: string | null;
  showArchived: boolean;
}

export function ThreadList({
  threads,
  activeThreadId,
  showArchived,
}: ThreadListProps) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Threads</h2>
        <Button
          asChild
          variant="default"
          size="xs"
          className="text-xs"
        >
          <Link href={"/concierge" as Route} aria-label="New thread">
            <Plus className="h-3 w-3" aria-hidden="true" />
            New thread
          </Link>
        </Button>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          No threads yet. Send a message to start your first Concierge
          conversation.
        </div>
      ) : (
        <ul className="flex flex-1 min-h-0 flex-col gap-1 overflow-y-auto">
          {threads.map((t) => (
            <li key={t.id}>
              <ThreadRow thread={t} active={t.id === activeThreadId} />
            </li>
          ))}
        </ul>
      )}

      <div className="border-t pt-2">
        <Button asChild variant="ghost" size="xs" className="w-full text-xs">
          <Link
            href={
              (showArchived
                ? "/concierge"
                : "/concierge?archived=true") as Route
            }
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
}: {
  thread: ThreadRow;
  active: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      className={cn(
        "group flex flex-col gap-1 rounded-md border px-2 py-2 text-sm transition-colors",
        active
          ? "border-primary/60 bg-primary/5"
          : "border-transparent hover:border-border hover:bg-accent/30",
      )}
    >
      {editing ? (
        <ThreadTitleEdit
          threadId={thread.id}
          initialTitle={thread.title ?? ""}
          onDone={() => setEditing(false)}
        />
      ) : (
        <div className="flex items-start gap-2">
          <Link
            href={(`/concierge?threadId=${thread.id}` as Route)}
            className={cn(
              "flex-1 min-w-0 truncate text-left text-sm",
              active ? "font-medium text-foreground" : "text-foreground",
            )}
          >
            {thread.title ?? "Untitled thread"}
          </Link>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setEditing(true)}
              aria-label={`Rename thread: ${thread.title ?? "Untitled thread"}`}
              title="Rename"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
            </Button>
            {thread.archivedAt ? (
              <span
                className="text-[10px] text-muted-foreground"
                title="Archived"
              >
                archived
              </span>
            ) : (
              <ArchiveButton threadId={thread.id} title={thread.title} />
            )}
          </div>
        </div>
      )}
      <span className="text-[10px] text-muted-foreground">
        {formatRelative(thread.lastMessageAt)}
      </span>
    </div>
  );
}

function ThreadTitleEdit({
  threadId,
  initialTitle,
  onDone,
}: {
  threadId: string;
  initialTitle: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialTitle);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Title cannot be empty");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameThreadAction({ threadId, title: trimmed });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-1">
      <label className="sr-only" htmlFor={`title-${threadId}`}>
        Thread title
      </label>
      <input
        id={`title-${threadId}`}
        type="text"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        maxLength={200}
        className="flex-1 min-w-0 rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        disabled={pending}
        aria-label="Save thread title"
      >
        <Check className="h-3 w-3" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onDone}
        disabled={pending}
        aria-label="Cancel rename"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </Button>
      {error && (
        <span role="alert" className="ml-1 text-[10px] text-destructive">
          {error}
        </span>
      )}
    </form>
  );
}

function ArchiveButton({
  threadId,
  title,
}: {
  threadId: string;
  title: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await archiveThreadAction({ threadId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onClick}
        disabled={pending}
        aria-label={`Archive thread: ${title ?? "Untitled thread"}`}
        title="Archive"
      >
        <Archive className="h-3 w-3" aria-hidden="true" />
      </Button>
      {error && (
        <span role="alert" className="ml-1 text-[10px] text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * Cheap relative-time formatter — "just now", "5m ago", "2h ago",
 * "3d ago", or fall back to a short date for >7d. Avoids pulling in
 * date-fns just for this surface.
 */
function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 30) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}
