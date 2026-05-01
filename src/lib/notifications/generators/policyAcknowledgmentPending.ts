// src/lib/notifications/generators/policyAcknowledgmentPending.ts

import type { Prisma } from "@prisma/client";
import { type NotificationProposal } from "./types";

/**
 * For each adopted PracticePolicy (retiredAt: null), find every active
 * PracticeUser who hasn't acknowledged the CURRENT policy version. Fires
 * once per (policy, user, version) — entityKey includes version so a
 * content update (POLICY_CONTENT_UPDATED bumps version) re-fires.
 *
 * Skip if the policy has an unfulfilled PolicyTrainingPrereq for that
 * user (the user can't acknowledge until the prereq training passes,
 * so a notification would be confusing).
 */
export async function generatePolicyAcknowledgmentPendingNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets the
  // staff member directly via the active-members query. Kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency with the rest of the generators.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const policies = await tx.practicePolicy.findMany({
    where: { practiceId, retiredAt: null },
    include: {
      acknowledgments: { select: { userId: true, policyVersion: true } },
      trainingPrereqs: { select: { trainingCourseId: true } },
    },
  });
  if (policies.length === 0) return [];

  const members = await tx.practiceUser.findMany({
    where: { practiceId, removedAt: null },
    select: { userId: true },
  });

  // Pre-fetch all passing completions for prereq checks (one query, no N+1)
  const allPasses = await tx.trainingCompletion.findMany({
    where: {
      practiceId,
      passed: true,
      expiresAt: { gt: new Date() },
    },
    select: { userId: true, courseId: true },
  });
  const passesByUser = new Map<string, Set<string>>();
  for (const p of allPasses) {
    let set = passesByUser.get(p.userId);
    if (!set) {
      set = new Set();
      passesByUser.set(p.userId, set);
    }
    set.add(p.courseId);
  }

  const proposals: NotificationProposal[] = [];
  for (const policy of policies) {
    // Build "users who have acked the CURRENT version" set
    const ackedUserIds = new Set(
      policy.acknowledgments
        .filter((a) => a.policyVersion === policy.version)
        .map((a) => a.userId),
    );
    const prereqCourseIds = policy.trainingPrereqs.map((p) => p.trainingCourseId);

    for (const m of members) {
      if (ackedUserIds.has(m.userId)) continue;
      // Prereq gating
      if (prereqCourseIds.length > 0) {
        const userPasses = passesByUser.get(m.userId) ?? new Set();
        const allPrereqsMet = prereqCourseIds.every((c) => userPasses.has(c));
        if (!allPrereqsMet) continue;
      }
      proposals.push({
        userId: m.userId,
        practiceId,
        type: "POLICY_ACKNOWLEDGMENT_PENDING",
        severity: "WARNING",
        title: `Policy review needed: ${policy.policyCode}`,
        body: `You have not acknowledged the current version (v${policy.version}) of ${policy.policyCode}. Read the policy and sign to confirm understanding.`,
        href: `/programs/policies/${policy.id}`,
        entityKey: `policy-ack-pending:${policy.id}:${policy.version}:${m.userId}`,
      });
    }
  }
  return proposals;
}
