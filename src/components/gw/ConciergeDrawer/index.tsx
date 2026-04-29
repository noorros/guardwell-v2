// src/components/gw/ConciergeDrawer/index.tsx
//
// The global AI Concierge drawer. Right-side Shadcn Sheet with a streaming
// chat UI that talks to /api/concierge/chat (SSE). The Concierge has access
// to 8 read-only tools (PR A2) and persists every message + tool invocation
// as event-sourced rows (PR A1 + A3).
//
// Naming note: an older per-page help drawer at AiAssistDrawer used to call
// itself "AI Concierge". As of PR A4, that one was renamed "Page Help" so
// this global, cross-page, streaming, tool-using chat is the sole "Concierge".
//
// State machine (per turn):
//   1. User submits → push USER message, append empty ASSISTANT message,
//      mark it streaming, kick off streamConciergeChat() generator
//   2. For each event yielded:
//        - thread_resolved: stash threadId in localStorage so the next turn
//          on this drawer (or the next mount) resumes the same conversation
//        - text_delta: append text to the streaming assistant message
//        - tool_use_started: insert a "tool chip" inline before further text
//        - tool_result: mark that chip as done with latency (or error)
//        - error: render an inline error banner; keep the assistant message
//          if any text was streamed before
//        - turn_complete: finalize the assistant message
//        - stream_done: clear pending; loop exits
//   3. AbortController is kept on a ref so the Stop button can cancel.
//
// Test mode: tests pass `__streamForTests` instead of relying on fetch.
// The fake generator yields the same StreamClientEvent shape, including
// `stream_done` to signal completion.
"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Bot } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  streamConciergeChat,
  type StreamClientEvent,
} from "./streamClient";

const STORAGE_KEY_THREAD = "gw-concierge-thread-id";

const EXAMPLE_PROMPTS = [
  "What's our HIPAA score?",
  "Show me incidents from this month.",
  "Which credentials expire in the next 90 days?",
] as const;

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

// Inline content of an assistant message: streamed text segments interleaved
// with tool-call chips. We keep a flat ordered list so render is just
// `parts.map(...)`. Text segments coalesce on consecutive text_deltas; a
// new segment is started whenever a tool_use_started splits the run.
type AssistantPart =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      toolUseId: string;
      toolName: string;
      status: "running" | "done" | "error";
      latencyMs: number | null;
      errorMessage: string | null;
    };

interface UserMessage {
  id: string;
  role: "user";
  content: string;
}

interface AssistantMessage {
  id: string;
  role: "assistant";
  parts: AssistantPart[];
  /** True while events are still streaming into this message. */
  streaming: boolean;
}

type UIMessage = UserMessage | AssistantMessage;

export interface ConciergeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Test-only: inject a fake stream so tests don't hit the SSE route. */
  __streamForTests?: (
    message: string,
  ) => AsyncGenerator<StreamClientEvent, void, unknown>;
  className?: string;
}

function generateId(): string {
  // crypto.randomUUID is fine in modern browsers + jsdom; fall back to a
  // timestamp+random for the (vanishingly unlikely) case it isn't.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ConciergeDrawer({
  open,
  onOpenChange,
  __streamForTests,
  className,
}: ConciergeDrawerProps) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [errorBanner, setErrorBanner] = useState<{
    code: string;
    message: string;
  } | null>(null);
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
  const abortRef = useRef<AbortController | null>(null);
  // Distinguishes a user-initiated Stop from a server-initiated ABORTED error.
  // handleStop sets this true; the error-event branch checks it before showing
  // the "Request canceled." banner; sendMessage's finally block resets it so
  // the next turn starts clean. Server-side aborts (Cloud Run timeout, network
  // drop) leave this false → banner still surfaces.
  const userAbortedRef = useRef(false);
  const inputId = useId();
  const logRef = useRef<HTMLOListElement | null>(null);

  // Auto-scroll to the bottom on every message change so newly streamed text
  // stays in view. JSDOM doesn't implement scrollHeight wiring, so guard.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Cancel in-flight stream on unmount or when the drawer closes.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [open]);

  function handleStop() {
    userAbortedRef.current = true;
    abortRef.current?.abort();
  }

  function handleNewThread() {
    abortRef.current?.abort();
    abortRef.current = null;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY_THREAD);
    }
    // Force the override to null so the resolved threadId returns to null
    // without waiting for the storage event (which doesn't fire same-tab).
    setThreadIdOverride(null);
    setMessages([]);
    setErrorBanner(null);
    setPending(false);
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setErrorBanner(null);
    const userMessage: UserMessage = {
      id: generateId(),
      role: "user",
      content: trimmed,
    };
    const assistantId = generateId();
    const assistantMessage: AssistantMessage = {
      id: assistantId,
      role: "assistant",
      parts: [],
      streaming: true,
    };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setPending(true);

    const ac = new AbortController();
    abortRef.current = ac;

    const generator = __streamForTests
      ? __streamForTests(trimmed)
      : streamConciergeChat({
          message: trimmed,
          threadId,
          signal: ac.signal,
        });

    try {
      for await (const event of generator) {
        if (ac.signal.aborted) break;
        applyStreamEvent(event, assistantId);
      }
    } catch (err) {
      if (ac.signal.aborted) {
        // Skip the banner for user-initiated cancels (the user already knows
        // they canceled). Server/network-initiated aborts still surface.
        if (!userAbortedRef.current) {
          setErrorBanner({
            code: "ABORTED",
            message: "Request canceled.",
          });
        }
      } else {
        setErrorBanner({
          code: "STREAM_ERROR",
          message:
            err instanceof Error ? err.message : "Stream failed unexpectedly.",
        });
      }
    } finally {
      // Mark the assistant message as no-longer-streaming regardless of how
      // we exited (completion, error, abort) so the cursor stops blinking.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.role === "assistant"
            ? { ...m, streaming: false }
            : m,
        ),
      );
      setPending(false);
      if (abortRef.current === ac) abortRef.current = null;
      // Reset so a subsequent server-initiated abort still surfaces.
      userAbortedRef.current = false;
    }
  }

  // Apply a single stream event to the assistant message identified by id.
  // (Renamed from `dispatchEvent` to avoid shadowing Window.dispatchEvent.)
  function applyStreamEvent(event: StreamClientEvent, assistantId: string) {
    switch (event.type) {
      case "thread_resolved": {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY_THREAD, event.threadId);
        }
        setThreadIdOverride(event.threadId);
        return;
      }
      case "text_delta": {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId || m.role !== "assistant") return m;
            // Defensive: drop late deltas that arrive after turn_complete has
            // already flipped streaming → false. Without this guard a stray
            // text_delta could silently append to a "completed" message.
            if (m.streaming === false) return m;
            const last = m.parts[m.parts.length - 1];
            if (last && last.kind === "text") {
              const updated = m.parts.slice(0, -1).concat({
                kind: "text" as const,
                text: last.text + event.text,
              });
              return { ...m, parts: updated };
            }
            return {
              ...m,
              parts: [...m.parts, { kind: "text" as const, text: event.text }],
            };
          }),
        );
        return;
      }
      case "tool_use_started": {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId || m.role !== "assistant") return m;
            return {
              ...m,
              parts: [
                ...m.parts,
                {
                  kind: "tool" as const,
                  toolUseId: event.toolUseId,
                  toolName: event.toolName,
                  status: "running",
                  latencyMs: null,
                  errorMessage: null,
                },
              ],
            };
          }),
        );
        return;
      }
      case "tool_result": {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId || m.role !== "assistant") return m;
            return {
              ...m,
              parts: m.parts.map((p) =>
                p.kind === "tool" && p.toolUseId === event.toolUseId
                  ? {
                      ...p,
                      status: event.error ? "error" : "done",
                      latencyMs: event.latencyMs,
                      errorMessage: event.error,
                    }
                  : p,
              ),
            };
          }),
        );
        return;
      }
      case "error": {
        // Suppress the banner only for user-initiated ABORTED. The server
        // emits ABORTED when request.signal fires; we can't tell apart a
        // user Stop click from a Cloud Run timeout at this layer except
        // via the userAbortedRef flag set in handleStop.
        if (event.code === "ABORTED" && userAbortedRef.current) return;
        setErrorBanner({ code: event.code, message: event.message });
        return;
      }
      case "turn_complete": {
        // Final accounting — nothing visible to apply right now (cost/tokens
        // could surface in a future "details" affordance), but flagging as a
        // distinct event lets the streaming flag be set false in finally.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.role === "assistant"
              ? { ...m, streaming: false }
              : m,
          ),
        );
        return;
      }
      case "stream_done": {
        // Generator has produced the [DONE] sentinel. The for-await will exit
        // naturally on the next iteration; nothing to mutate here.
        return;
      }
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to submit; Shift+Enter for newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col p-0 sm:max-w-md",
          className,
        )}
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

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!hasMessages ? (
            <EmptyState
              onPickPrompt={(prompt) => setInput(prompt)}
              disabled={pending}
            />
          ) : (
            <ol
              ref={logRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label="Conversation"
              className="flex flex-col gap-3"
            >
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserBubble key={m.id} message={m} />
                ) : (
                  <AssistantBubble key={m.id} message={m} />
                ),
              )}
            </ol>
          )}
          {errorBanner && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-[color:var(--gw-color-risk,#dc2626)] bg-destructive/10 p-2 text-xs text-destructive"
            >
              <span className="font-mono font-medium">{errorBanner.code}</span>
              <span className="mx-1">·</span>
              <span>{errorBanner.message}</span>
            </div>
          )}
        </div>

        <SheetFooter className="border-t p-4">
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <label htmlFor={inputId} className="sr-only">
              Ask the GuardWell Concierge
            </label>
            <textarea
              id={inputId}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onTextareaKeyDown}
              placeholder="Ask the Concierge…"
              rows={2}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
              disabled={pending}
            />
            {pending ? (
              <Button
                type="button"
                onClick={handleStop}
                variant="outline"
                className="w-full"
              >
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!input.trim()}
                className="w-full"
              >
                Send
              </Button>
            )}
          </form>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState({
  onPickPrompt,
  disabled,
}: {
  onPickPrompt: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border bg-muted/40 p-3 text-sm text-foreground">
        Ask anything about your practice&apos;s compliance. The Concierge can
        look up scores, incidents, credentials, deadlines, and more.
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        Try one of these
      </p>
      <ul className="flex flex-col gap-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPickPrompt(prompt)}
              className="w-full rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
            >
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UserBubble({ message }: { message: UserMessage }) {
  return (
    <li className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-secondary px-3 py-2 text-sm text-secondary-foreground">
        <span className="whitespace-pre-wrap">{message.content}</span>
      </div>
    </li>
  );
}

function AssistantBubble({ message }: { message: AssistantMessage }) {
  return (
    <li className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-primary/10 px-3 py-2 text-sm text-foreground">
        {message.parts.length === 0 && message.streaming && (
          <span className="text-xs text-muted-foreground">Thinking…</span>
        )}
        {message.parts.map((part, idx) =>
          part.kind === "text" ? (
            <span
              key={`text-${idx}`}
              className="whitespace-pre-wrap"
            >
              {part.text}
            </span>
          ) : (
            <ToolChip key={part.toolUseId} part={part} />
          ),
        )}
      </div>
    </li>
  );
}

function ToolChip({
  part,
}: {
  part: Extract<AssistantPart, { kind: "tool" }>;
}) {
  const statusLabel =
    part.status === "running"
      ? "running"
      : part.status === "error"
        ? "error"
        : "done";
  const ariaLabel = `Tool ${part.toolName} ${statusLabel}${
    part.latencyMs != null ? `, ${part.latencyMs}ms` : ""
  }${part.errorMessage ? `, ${part.errorMessage}` : ""}`;
  return (
    <span
      aria-label={ariaLabel}
      className={cn(
        "mx-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 align-middle text-[11px] font-mono",
        part.status === "running" &&
          "border-muted-foreground/40 bg-muted text-muted-foreground",
        part.status === "done" &&
          "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
        part.status === "error" &&
          "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <span>Tool: {part.toolName}</span>
      {part.status === "done" && (
        <>
          <span aria-hidden="true">{"✓"}</span>
          {part.latencyMs != null && <span>{part.latencyMs}ms</span>}
        </>
      )}
      {part.status === "error" && (
        <>
          <span aria-hidden="true">{"⚠"}</span>
          {part.latencyMs != null && <span>{part.latencyMs}ms</span>}
        </>
      )}
    </span>
  );
}
