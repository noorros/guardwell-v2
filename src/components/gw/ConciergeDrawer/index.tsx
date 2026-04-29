// src/components/gw/ConciergeDrawer/index.tsx
//
// The global AI Concierge drawer. Right-side Shadcn Sheet wrapping the
// shared <ConciergeConversation> chat surface (the streaming state machine,
// composer, and message list moved into that component as of PR A5).
//
// Drawer-specific responsibilities (NOT in ConciergeConversation):
//   - localStorage thread persistence (via useSyncExternalStore for cross-tab)
//   - "New thread" button (clears localStorage + remounts the conversation
//     via a key bump so its internal state resets cleanly)
//
// Naming note: an older per-page help drawer at AiAssistDrawer used to call
// itself "AI Concierge". As of PR A4, that one was renamed "Page Help" so
// this global, cross-page, streaming, tool-using chat is the sole "Concierge".
//
// Test mode: tests pass `__streamForTests` instead of relying on fetch.
// The fake generator yields the same StreamClientEvent shape, including
// `stream_done` to signal completion.
"use client";

import { useState, useSyncExternalStore } from "react";
import { Bot } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConciergeConversation } from "@/components/gw/ConciergeConversation";
import type { StreamClientEvent } from "./streamClient";

const STORAGE_KEY_THREAD = "gw-concierge-thread-id";

// useSyncExternalStore subscriber for the threadId localStorage key. The
// `storage` event fires only on cross-tab updates; same-tab updates are
// applied via the override state inside the component (see useState below).
function subscribeThreadStorage(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
function getStoredThreadId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY_THREAD);
}
function getServerThreadId(): null {
  return null;
}

export interface ConciergeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Test-only: inject a fake stream so tests don't hit the SSE route. */
  __streamForTests?: (
    message: string,
  ) => AsyncGenerator<StreamClientEvent, void, unknown>;
  className?: string;
}

export function ConciergeDrawer({
  open,
  onOpenChange,
  __streamForTests,
  className,
}: ConciergeDrawerProps) {
  // threadId is persisted via localStorage so a reload (or a sibling tab)
  // resumes the same conversation. useSyncExternalStore syncs cross-tab;
  // same-tab updates use `threadIdOverride` so we don't need a useEffect
  // to setState (which trips the project's react-hooks/set-state-in-effect
  // lint rule).
  const persistedThreadId = useSyncExternalStore<string | null>(
    subscribeThreadStorage,
    getStoredThreadId,
    getServerThreadId,
  );
  const [threadIdOverride, setThreadIdOverride] = useState<string | null>(
    null,
  );
  const threadId = threadIdOverride ?? persistedThreadId;

  // Bump on "New thread" to force a remount of <ConciergeConversation>,
  // wiping its internal messages + AbortController + error banner state.
  const [conversationKey, setConversationKey] = useState(0);

  // Tracks whether the conversation has any messages — surfaces the
  // "New thread" button only after the first turn (matches the pre-A5 UI).
  const [hasMessages, setHasMessages] = useState(false);

  // Reset hasMessages whenever we start a new conversation (key bump).
  // Same-render setState; no useEffect needed because we drive the bump
  // ourselves from handleNewThread.
  function handleNewThread() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY_THREAD);
    }
    setThreadIdOverride(null);
    setConversationKey((k) => k + 1);
    setHasMessages(false);
  }

  // Note: closing the drawer unmounts ConciergeConversation (Radix removes
  // SheetContent from the portal when open=false), and the conversation's
  // own cleanup effect aborts any in-flight stream — no need for an
  // explicit teardown here.

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn("flex w-full flex-col p-0 sm:max-w-md", className)}
      >
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" aria-hidden="true" />
            GuardWell Concierge
          </SheetTitle>
          <SheetDescription>
            Ask anything about your practice&apos;s compliance. Read-only.
          </SheetDescription>
          {hasMessages && (
            <div className="pt-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={handleNewThread}
                className="text-xs"
              >
                New thread
              </Button>
            </div>
          )}
        </SheetHeader>

        <ConciergeConversation
          key={conversationKey}
          surface="drawer"
          initialThreadId={threadId}
          __streamForTests={__streamForTests}
          onThreadResolved={(resolved) => {
            if (typeof window !== "undefined") {
              window.localStorage.setItem(STORAGE_KEY_THREAD, resolved);
            }
            setThreadIdOverride(resolved);
          }}
          onMessagesChange={({ hasMessages: nowHasMessages }) =>
            setHasMessages(nowHasMessages)
          }
          className="flex-1 min-h-0"
        />
      </SheetContent>
    </Sheet>
  );
}
