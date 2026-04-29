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
import { replayThreadHistory } from "@/lib/concierge/replayHistory";

// Per-user thread membership + dynamic searchParams require fresh server
// renders on every nav. Caching this route would leak threads across users.
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
    // replayThreadHistory groups TOOL rows with the next ASSISTANT message
    // (createdAt-asc) so resumed threads render their original tool chips.
    // Orphan TOOL rows at the tail (no closing ASSISTANT) are dropped with
    // a console.warn — see src/lib/concierge/replayHistory.ts for details.
    initialMessages = replayThreadHistory(messages);
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
      {/* Mobile-only thread switcher. Below md, the left rail is hidden
          to give the conversation pane the full width — but users still
          need a way to navigate / archive / rename. Lowest-effort fix is
          a native <details> collapsible exposing the same <ThreadList>.
          TODO(future PR): replace this with a proper mobile thread-
          switcher Sheet — current pattern is functional but ergonomically
          poor on small screens. */}
      <details className="md:hidden">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
          All threads ({threads.length})
        </summary>
        <div className="mt-2">
          <ThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            showArchived={showArchived}
          />
        </div>
      </details>
      <div className="flex flex-1 min-h-0 gap-4">
        {/* TODO(future PR): the desktop left rail is the only thread
            navigator on md+. Mobile users use the <details> collapsible
            above. A unified responsive drawer/sheet would be cleaner. */}
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
