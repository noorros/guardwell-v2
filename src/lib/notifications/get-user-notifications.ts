// src/lib/notifications/get-user-notifications.ts
//
// Tiny server helper — used by the AppShell to hydrate the topbar bell
// on every dashboard navigation. Returns the 10 most recent
// notifications + an unread count.

import { db } from "@/lib/db";

export interface UserNotificationsSummary {
  unreadCount: number;
  recent: Array<{
    id: string;
    type: string;
    severity: string;
    title: string;
    body: string;
    href: string | null;
    createdAtIso: string;
    readAt: string | null;
  }>;
}

export async function getUserNotificationsSummary(
  userId: string,
): Promise<UserNotificationsSummary> {
  const [unreadCount, recent] = await Promise.all([
    db.notification.count({
      where: { userId, readAt: null },
    }),
    db.notification.findMany({
      where: { userId },
      orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
      take: 10,
    }),
  ]);
  return {
    unreadCount,
    recent: recent.map((n) => ({
      id: n.id,
      type: n.type,
      severity: n.severity,
      title: n.title,
      body: n.body,
      href: n.href,
      createdAtIso: n.createdAt.toISOString(),
      readAt: n.readAt?.toISOString() ?? null,
    })),
  };
}
