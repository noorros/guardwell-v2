// tests/integration/concierge-actions.test.ts
//
// Integration tests for the rename + archive thread server actions
// shipped in PR A5. Pattern: vitest exercises the pure-input
// helpers (handleRenameThread / handleArchiveThread) which receive an
// already-authorized {practiceId, userId} ctx; the "use server"
// wrappers (renameThreadAction / archiveThreadAction) stitch the
// auth resolution on top via getPracticeUser, which we don't have a
// Firebase cookie for under vitest. This mirrors the
// credential-ceu-action / baa-send-action patterns.
//
// next/cache.revalidatePath needs a Next request context that vitest
// doesn't provide — stubbed out to a no-op for these tests.

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectConciergeThreadCreated } from "@/lib/events/projections/conciergeThread";

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

async function seedPracticeWithThread() {
  const user = await db.user.create({
    data: {
      firebaseUid: `concierge-act-${Math.random().toString(36).slice(2, 10)}`,
      email: `concierge-act-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Concierge Action Test", primaryState: "TX" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const threadId = randomUUID();
  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "CONCIERGE_THREAD_CREATED",
      payload: { threadId, userId: user.id, title: "Original title" },
    },
    async (tx) =>
      projectConciergeThreadCreated(tx, {
        practiceId: practice.id,
        payload: { threadId, userId: user.id, title: "Original title" },
      }),
  );
  return { user, practice, threadId };
}

describe("Concierge thread management actions", () => {
  it("handleRenameThread updates the title via CONCIERGE_THREAD_RENAMED", async () => {
    const { user, practice, threadId } = await seedPracticeWithThread();
    const { handleRenameThread } = await import(
      "@/app/(dashboard)/concierge/actions"
    );
    const result = await handleRenameThread(
      { practiceId: practice.id, userId: user.id },
      { threadId, title: "Renamed via action" },
    );
    expect(result.ok).toBe(true);
    const thread = await db.conversationThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(thread.title).toBe("Renamed via action");
  });

  it("handleArchiveThread sets archivedAt", async () => {
    const { user, practice, threadId } = await seedPracticeWithThread();
    const { handleArchiveThread } = await import(
      "@/app/(dashboard)/concierge/actions"
    );
    const before = await db.conversationThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(before.archivedAt).toBeNull();

    const result = await handleArchiveThread(
      { practiceId: practice.id, userId: user.id },
      { threadId },
    );
    expect(result.ok).toBe(true);

    const after = await db.conversationThread.findUniqueOrThrow({
      where: { id: threadId },
    });
    expect(after.archivedAt).not.toBeNull();
  });

  it("renameThreadAction returns 404-style error when thread doesn't exist", async () => {
    const { renameThreadAction } = await import(
      "@/app/(dashboard)/concierge/actions"
    );
    // No matching thread row → authorize step returns null → action
    // returns { ok: false, error: "Thread not found" } without leaking
    // existence to a different practice's user.
    const result = await renameThreadAction({
      threadId: randomUUID(),
      title: "Whatever",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
    }
  });
});
