// src/app/(dashboard)/settings/notifications/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { runNotificationDigest } from "@/lib/notifications/run-digest";

const MarkReadInput = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
});

export async function markNotificationReadAction(
  input: z.infer<typeof MarkReadInput>,
): Promise<{ count: number }> {
  const user = await requireUser();
  const parsed = MarkReadInput.parse(input);
  const now = new Date();
  const result = await db.notification.updateMany({
    where: { id: { in: parsed.ids }, userId: user.id, readAt: null },
    data: { readAt: now },
  });
  revalidatePath("/");
  return { count: result.count };
}

const PreferencesInput = z.object({
  digestEnabled: z.boolean(),
  criticalAlertsEnabled: z.boolean(),
  emailEnabled: z.boolean(),
});

export async function updateNotificationPreferencesAction(
  input: z.infer<typeof PreferencesInput>,
): Promise<void> {
  const user = await requireUser();
  const parsed = PreferencesInput.parse(input);
  await db.notificationPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      digestEnabled: parsed.digestEnabled,
      criticalAlertsEnabled: parsed.criticalAlertsEnabled,
      emailEnabled: parsed.emailEnabled,
    },
    update: {
      digestEnabled: parsed.digestEnabled,
      criticalAlertsEnabled: parsed.criticalAlertsEnabled,
      emailEnabled: parsed.emailEnabled,
    },
  });
  revalidatePath("/settings/notifications");
}

/**
 * Manual digest trigger. Callable by any authenticated user, for any
 * practice they belong to — useful for testing notification delivery
 * during onboarding or after configuration changes. Runs the SAME
 * routine as the Cloud Scheduler cron endpoint, so this is a UI-level
 * shortcut rather than a separate code path.
 */
export async function runDigestNowAction(): Promise<{
  practicesScanned: number;
  notificationsCreated: number;
  emailsDelivered: number;
}> {
  await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can run the digest manually");
  }
  const summary = await runNotificationDigest();
  revalidatePath("/settings/notifications");
  revalidatePath("/");
  return {
    practicesScanned: summary.practicesScanned,
    notificationsCreated: summary.notificationsCreated,
    emailsDelivered: summary.emailsDelivered,
  };
}
