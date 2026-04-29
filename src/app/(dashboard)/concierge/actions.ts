// src/app/(dashboard)/concierge/actions.ts
//
// Server actions for the /concierge route. Both rename + archive go
// through appendEventAndApply per ADR-0001 — the eslint
// `gw/no-direct-projection-mutation` rule blocks any direct
// db.conversationThread.update from this file.
//
// Pattern: the public "use server" exports (renameThreadAction,
// archiveThreadAction) only resolve auth and delegate to a pure-input
// helper (handleRenameThread, handleArchiveThread). Tests exercise the
// helpers directly, dodging the Firebase cookie + Next.js request
// context that vitest doesn't provide. Same pattern as
// credential-ceu-action.test.ts and baa-send-action.test.ts.

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectConciergeThreadRenamed,
  projectConciergeThreadArchived,
} from "@/lib/events/projections/conciergeThread";

const RenameInput = z.object({
  threadId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});
const ArchiveInput = z.object({ threadId: z.string().min(1) });

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Pure-input helper: validates + appends the event. Caller must have
 * already authorized the user against the thread's practice. Used by
 * the server-action wrapper below and by integration tests.
 */
export async function handleRenameThread(
  args: { practiceId: string; userId: string },
  input: z.infer<typeof RenameInput>,
): Promise<ActionResult> {
  const parsed = RenameInput.parse(input);
  await appendEventAndApply(
    {
      practiceId: args.practiceId,
      actorUserId: args.userId,
      type: "CONCIERGE_THREAD_RENAMED",
      payload: { threadId: parsed.threadId, title: parsed.title },
    },
    async (tx) =>
      projectConciergeThreadRenamed(tx, {
        practiceId: args.practiceId,
        payload: { threadId: parsed.threadId, title: parsed.title },
      }),
  );
  return { ok: true };
}

export async function handleArchiveThread(
  args: { practiceId: string; userId: string },
  input: z.infer<typeof ArchiveInput>,
): Promise<ActionResult> {
  const parsed = ArchiveInput.parse(input);
  await appendEventAndApply(
    {
      practiceId: args.practiceId,
      actorUserId: args.userId,
      type: "CONCIERGE_THREAD_ARCHIVED",
      payload: { threadId: parsed.threadId },
    },
    async (tx) =>
      projectConciergeThreadArchived(tx, {
        practiceId: args.practiceId,
        payload: { threadId: parsed.threadId },
      }),
  );
  return { ok: true };
}

/**
 * Look up a thread + ensure the caller is the thread's owner inside the
 * thread's practice. Returns null if not found OR not authorized; both
 * cases collapse to a single 404-style response so we never leak
 * existence to a different practice's user.
 */
async function authorizeThread(threadId: string): Promise<
  | { practiceId: string; userId: string }
  | null
> {
  const thread = await db.conversationThread.findUnique({
    where: { id: threadId },
    select: { practiceId: true, userId: true },
  });
  if (!thread) return null;
  const pu = await getPracticeUser(thread.practiceId);
  if (!pu || pu.dbUser.id !== thread.userId) return null;
  return { practiceId: pu.practiceId, userId: pu.dbUser.id };
}

export async function renameThreadAction(
  input: z.infer<typeof RenameInput>,
): Promise<ActionResult> {
  const parsed = RenameInput.parse(input);
  const ctx = await authorizeThread(parsed.threadId);
  if (!ctx) return { ok: false, error: "Thread not found" };
  const result = await handleRenameThread(ctx, parsed);
  revalidatePath("/concierge");
  return result;
}

export async function archiveThreadAction(
  input: z.infer<typeof ArchiveInput>,
): Promise<ActionResult> {
  const parsed = ArchiveInput.parse(input);
  const ctx = await authorizeThread(parsed.threadId);
  if (!ctx) return { ok: false, error: "Thread not found" };
  const result = await handleArchiveThread(ctx, parsed);
  revalidatePath("/concierge");
  return result;
}
