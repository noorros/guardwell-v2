// src/lib/notifications/generators/system.ts

import type { Prisma } from "@prisma/client";
import { type NotificationProposal } from "./types";

/**
 * SYSTEM_NOTIFICATION skeleton. No production firing path yet — the
 * admin-broadcast UI lands in a future phase. Wired into the fan-in so
 * the enum surface and generator surface stay aligned; returns an empty
 * array unconditionally for now.
 */
export async function generateSystemNotifications(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _tx: Prisma.TransactionClient,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  // TODO(future-phase): admin broadcast UI lands later. For now, this is
  // a no-op stub so the SYSTEM_NOTIFICATION enum value is wired into the
  // fan-in without any production firing path.
  return [];
}
