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

// Phase 7 PR 7 — extended with cadence + weekly schedule fields. The UI
// only surfaces digestDay + digestTime when cadence === "WEEKLY"; the
// server still accepts and persists those values for any cadence so that
// switching back to WEEKLY restores the user's prior schedule rather than
// resetting to defaults.
const PreferencesInput = z.object({
  digestEnabled: z.boolean(),
  criticalAlertsEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  cadence: z.enum(["INSTANT", "DAILY", "WEEKLY", "NONE"]),
  digestDay: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]),
  digestTime: z
    .string()
    .regex(/^[0-2][0-9]:[0-5][0-9]$/, "HH:MM 24-hour format"),
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
      cadence: parsed.cadence,
      digestDay: parsed.digestDay,
      digestTime: parsed.digestTime,
    },
    update: {
      digestEnabled: parsed.digestEnabled,
      criticalAlertsEnabled: parsed.criticalAlertsEnabled,
      emailEnabled: parsed.emailEnabled,
      cadence: parsed.cadence,
      digestDay: parsed.digestDay,
      digestTime: parsed.digestTime,
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
