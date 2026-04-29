// src/app/(dashboard)/concierge/page.tsx
//
// Full-page Concierge surface (PR A5). Two-column layout:
//   left rail = <ThreadList> (rename / archive / new thread)
//   right pane = <ConciergeConversation> (the same streaming chat surface
//                used by the floating drawer, surface="page" mode)
//
// Active thread is resolved from `?threadId=...` (query param wins) or
// falls back to the newest non-archived thread. Empty state — no
// threads at all — collapses to the conversation pane in "page" mode
// which renders its own onboarding empty state.
import { redirect } from "next/navigation";
import type { Route } from "next";
import { Bot } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { ConciergeConversation } from "@/components/gw/ConciergeConversation";
import { ThreadList } from "@/components/gw/ConciergeConversation/ThreadList";
import type { UIMessage } from "@/components/gw/ConciergeConversation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "GuardWell Concierge",
};

export default async function ConciergePage({
  searchParams,
}: {
  searchParams?: Promise<{ threadId?: string; archived?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const pu = await getPracticeUser();
  if (!pu) redirect("/sign-in" as Route);

  const showArchived = sp.archived === "true";

  const threads = await db.conversationThread.findMany({
    where: {
      practiceId: pu.practiceId,
      userId: pu.dbUser.id,
      ...(showArchived ? {} : { archivedAt: null }),
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      lastMessageAt: true,
      archivedAt: true,
    },
  });

  // Resolve active thread: explicit search param wins (validated against
  // the user's own threads to prevent IDOR via URL guessing); otherwise
  // newest. Falls through to null when the user has no threads.
  const requestedThreadId = sp.threadId ?? null;
  const activeThreadId =
    (requestedThreadId &&
      threads.find((t) => t.id === requestedThreadId)?.id) ??
    threads[0]?.id ??
    null;

  let initialMessages: UIMessage[] = [];
  if (activeThreadId) {
    const messages = await db.conversationMessage.findMany({
      where: { threadId: activeThreadId },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true,
        role: true,
        content: true,
        payload: true,
      },
    });
    initialMessages = messages.flatMap<UIMessage>((m) => {
      // Only USER + ASSISTANT messages are surfaced in the conversation
      // pane; TOOL rows are persisted for audit but folded into the
      // assistant bubble's tool-chip via streaming events. On historical
      // load we don't have the raw tool_use_started/result event ordering
      // recorded, so for now we drop TOOL rows from the rendered list.
      if (m.role === "USER") {
        return [
          {
            id: m.id,
            role: "user" as const,
            content: m.content,
          },
        ];
      }
      if (m.role === "ASSISTANT") {
        return [
          {
            id: m.id,
            role: "assistant" as const,
            parts: [{ kind: "text" as const, text: m.content }],
            // Historical messages are NOT streaming — they're hydrated.
            streaming: false,
          },
        ];
      }
      return [];
    });
  }

  return (
    <main className="mx-auto flex h-[calc(100vh-4rem)] max-w-7xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <Breadcrumb items={[{ label: "Concierge" }]} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Bot className="h-3 w-3" aria-hidden="true" />
          <span>{threads.length} thread{threads.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="flex flex-1 min-h-0 gap-4">
        <aside className="hidden w-72 shrink-0 md:block">
          <ThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            showArchived={showArchived}
          />
        </aside>
        <section className="flex-1 min-w-0 overflow-hidden rounded-lg border bg-card">
          <ConciergeConversation
            // Remount when active thread changes so the internal state
            // (messages, error banner, abort controller) starts fresh.
            key={activeThreadId ?? "new"}
            surface="page"
            initialThreadId={activeThreadId}
            initialMessages={initialMessages}
          />
        </section>
      </div>
    </main>
  );
}
