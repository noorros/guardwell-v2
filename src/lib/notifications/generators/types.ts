// src/lib/notifications/generators/types.ts
//
// Shared types + constants for the notification generator family. Lives
// at the root of the generators/ folder so per-generator files can import
// without circular risk.

import type { NotificationType, NotificationSeverity } from "@prisma/client";

export interface NotificationProposal {
  userId: string;
  practiceId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string | null;
  entityKey: string | null;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
