// src/app/(dashboard)/settings/reminders/page.tsx
//
// Phase 7 PR 8 — admin-only surface for editing per-practice reminder
// lead-time overrides. The Practice.reminderSettings JSON column is read
// by every notification generator via getEffectiveLeadTimes(); empty /
// missing keys fall back to DEFAULT_LEAD_TIMES from
// src/lib/notifications/leadTimes.ts.
//
// STAFF/VIEWER are redirected to the settings index so the navigation
// model stays "see only what you can act on" — settings index also
// hides this tile for non-admins (see settings/page.tsx).

import type { Route } from "next";
import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { RemindersForm } from "./RemindersForm";

export const metadata = { title: "Reminder lead times · Settings · GuardWell" };
export const dynamic = "force-dynamic";

export default async function ReminderSettingsPage() {
  const pu = await getPracticeUser();
  if (!pu) redirect("/sign-in" as Route);

  // Role-gate: OWNER + ADMIN only. STAFF/VIEWER bounce back to the
  // settings index, which already hides the tile for them.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    redirect("/settings" as Route);
  }

  const practice = await db.practice.findUnique({
    where: { id: pu.practiceId },
    select: { reminderSettings: true },
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "Settings" }, { label: "Reminders" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Clock className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Reminder lead times
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure how many days before a deadline GuardWell starts reminding
            you. Each category supports multiple milestones — staff get one nudge
            per crossed milestone. Leave blank to use the default schedule.
          </p>
        </div>
      </header>
      <Card>
        <CardContent className="space-y-5 p-6">
          <RemindersForm initialSettings={practice?.reminderSettings ?? null} />
        </CardContent>
      </Card>
    </main>
  );
}
