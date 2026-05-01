// src/lib/notifications/generators/baaExecuted.ts

import type { Prisma } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal, DAY_MS } from "./types";
import { ownerAdminUserIds } from "./helpers";

/**
 * Informational: fires once when a BAA flips to EXECUTED. Limited to
 * the last 14 days of execution events so older BAAs don't spam every
 * digest run. EntityKey is keyed only on the BaaRequest.id so it fires
 * exactly once across all digest runs.
 */
export async function generateBaaExecutedNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets
  // OWNER + ADMIN directly via PracticeUser query. Param kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  // Only consider BAAs executed in the last 14 days — older ones have
  // already been notified or naturally surface in the vendor list.
  const cutoff = new Date(Date.now() - 14 * DAY_MS);
  const requests = await tx.baaRequest.findMany({
    where: {
      practiceId,
      status: "EXECUTED",
      executedAt: { gte: cutoff },
    },
    select: {
      id: true,
      executedAt: true,
      vendor: { select: { name: true } },
    },
  });
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];

  const proposals: NotificationProposal[] = [];
  for (const r of requests) {
    if (!r.executedAt) continue;
    const title = `BAA executed: ${r.vendor.name}`;
    const body = `The Business Associate Agreement with ${r.vendor.name} was executed on ${formatPracticeDate(r.executedAt, practiceTimezone)}.`;
    for (const userId of adminUserIds) {
      proposals.push({
        userId,
        practiceId,
        type: "BAA_EXECUTED",
        severity: "INFO",
        title,
        body,
        href: "/programs/vendors",
        entityKey: `baa-executed:${r.id}`,
      });
    }
  }
  return proposals;
}
