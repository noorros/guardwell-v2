// src/components/gw/ConciergeConversation/index.tsx
//
// The reusable "Concierge chat surface" — message list, composer footer,
// streaming state machine. Used by both <ConciergeDrawer> (drawer mode,
// in a Sheet) and /concierge page (full-page mode, in a flex column).
//
// State: messages, streaming, error, threadId — owned here.
// Streaming: same async-generator + AbortController pattern as the drawer.
// Empty state: 3 example prompts, only shown when surface=drawer (full-page
// shows its own empty state in the parent route shell).
//
// Thread persistence: this component does NOT manage localStorage. The
// drawer wraps it with localStorage handling; the /concierge page wraps it
// with URL search-param handling. Parents pass `initialThreadId` and
// receive `onThreadResolved` when the server resolves a thread id.
"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  streamConciergeChat,
  type StreamClientEvent,
} from "@/components/gw/ConciergeDrawer/streamClient";

const EXAMPLE_PROMPTS = [
  "What's our HIPAA score?",
  "Show me incidents from this month.",
  "Which credentials expire in the next 90 days?",
] as const;

// Inline content of an assistant message: streamed text segments interleaved
// with tool-call chips. We keep a flat ordered list so render is just
// `parts.map(...)`. Text segments coalesce on consecutive text_deltas; a
// new segment is started whenever a tool_use_started splits the run.
export type AssistantPart =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      toolUseId: string;
      toolName: string;
      status: "running" | "done" | "error";
      latencyMs: number | null;
      errorMessage: string | null;
    };

export interface UserMessage {
  id: string;
  role: "user";
  content: string;
}

export interface AssistantMessage {
  id: string;
  role: "assistant";
  parts: AssistantPart[];
  /** True while events are still streaming into this message. */
  streaming: boolean;
}

export type UIMessage = UserMessage | AssistantMessage;

export interface ConciergeConversationProps {
  /** Initial threadId to resume. null/undefined = start a new thread on first send. */
  initialThreadId?: string | null;
  /** Initial messages to render (loaded server-side for the /concierge route). */
  initialMessages?: UIMessage[];
  /** Mode hint for layout decisions (drawer is more compact + shows the empty-state prompts). */
  surface?: "drawer" | "page";
  /** Test-only: inject a fake stream so tests don't hit the SSE route. */
  __streamForTests?: (
    message: string,
  ) => AsyncGenerator<StreamClientEvent, void, unknown>;
  /**
   * Called when the SSE backend resolves the threadId for the current turn.
   * Drawer mode persists this in localStorage; page mode pushes it to the
   * URL search params.
   */
  onThreadResolved?: (threadId: string) => void;
  /**
   * Called when the message list transitions from empty → non-empty.
   * Drawer uses this to reveal its "New thread" button alongside the
   * Concierge title without the parent having to mirror message state.
   */
  onMessagesChange?: (info: { hasMessages: boolean }) => void;
  className?: string;
}

export function generateId(): string {
  // crypto.randomUUID is fine in modern browsers + jsdom; fall back to a
  // timestamp+random for the (vanishingly unlikely) case it isn't.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ConciergeConversation({
  initialThreadId,
  initialMessages,
  surface = "drawer",
  __streamForTests,
  onThreadResolved,
  onMessagesChange,
  className,
}: ConciergeConversationProps) {
  const [messages, setMessages] = useState<UIMessage[]>(
    () => initialMessages ?? [],
  );
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [errorBanner, setErrorBanner] = useState<{
    code: string;
    message: string;
  } | null>(null);
  // threadId is the active thread for THIS conversation surface. Parent
  // owns persistence (localStorage in drawer mode, URL in page mode); we
  // just track it in component state so the next turn can include it.
  const [threadId, setThreadId] = useState<string | null>(
    initialThreadId ?? null,
  );
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

  // We deliberately do NOT sync `threadId` from a changing `initialThreadId`
  // prop via an effect — the lint rule `react-hooks/set-state-in-effect` and
  // the project convention forbid that pattern. Callers MUST remount this
  // component when the active thread changes (e.g. /concierge does so via
  // `key={activeThreadId}`); the drawer never changes initialThreadId after
  // first mount because the new-thread flow remounts via its own `key`.

  // Cancel in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  function handleStop() {
    userAbortedRef.current = true;
    abortRef.current?.abort();
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
    // Transition empty → non-empty fires onMessagesChange BEFORE the
    // setMessages call so subscribers (e.g. ConciergeDrawer's New-thread
    // affordance) react in the same paint frame as the user message bubble.
    if (messages.length === 0) {
      onMessagesChange?.({ hasMessages: true });
    }
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
        setThreadId(event.threadId);
        onThreadResolved?.(event.threadId);
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
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!hasMessages ? (
          surface === "drawer" ? (
            <EmptyState
              onPickPrompt={(prompt) => setInput(prompt)}
              disabled={pending}
            />
          ) : (
            <PageEmptyState
              onPickPrompt={(prompt) => setInput(prompt)}
              disabled={pending}
            />
          )
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

      <div className="border-t p-4">
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
            <Button type="submit" disabled={!input.trim()} className="w-full">
              Send
            </Button>
          )}
        </form>
      </div>
    </div>
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

function PageEmptyState({
  onPickPrompt,
  disabled,
}: {
  onPickPrompt: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-8">
      <div className="rounded-lg border bg-muted/40 p-4 text-sm text-foreground">
        <p className="font-medium">Start a new Concierge thread.</p>
        <p className="mt-1 text-muted-foreground">
          Ask anything about your practice&apos;s compliance. The Concierge can
          look up scores, incidents, credentials, deadlines, and more.
        </p>
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
            <span key={`text-${idx}`} className="whitespace-pre-wrap">
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
