// src/app/(dashboard)/settings/notifications/page.tsx
import { BellRing } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { NotificationPreferencesForm } from "./NotificationPreferencesForm";
import { RunDigestNowButton } from "./RunDigestNowButton";

export const metadata = { title: "Notification preferences · Settings" };
export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const prefs = await db.notificationPreference.findUnique({
    where: { userId: pu.userId },
  });
  const isAdmin = pu.role === "OWNER" || pu.role === "ADMIN";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "Settings" }, { label: "Notifications" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <BellRing className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Notification preferences
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose how GuardWell reaches out about compliance deadlines, open
            incidents, and critical alerts. All toggles default to on; email
            delivery additionally depends on Resend being configured at the
            account level.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-5 p-6">
          <NotificationPreferencesForm
            initial={{
              digestEnabled: prefs?.digestEnabled ?? true,
              criticalAlertsEnabled: prefs?.criticalAlertsEnabled ?? true,
              emailEnabled: prefs?.emailEnabled ?? true,
              cadence:
                (prefs?.cadence as
                  | "INSTANT"
                  | "DAILY"
                  | "WEEKLY"
                  | "NONE"
                  | undefined) ?? "DAILY",
              digestDay:
                (prefs?.digestDay as
                  | "MON"
                  | "TUE"
                  | "WED"
                  | "THU"
                  | "FRI"
                  | "SAT"
                  | "SUN"
                  | undefined) ?? "MON",
              digestTime: prefs?.digestTime ?? "08:00",
            }}
          />
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardContent className="flex items-start justify-between gap-4 p-6">
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="text-sm font-semibold">Run digest now</h2>
              <p className="text-xs text-muted-foreground">
                Immediately scan every practice you belong to, generate new
                notifications for anything currently at risk, and send digest
                emails to users who have email delivery enabled. Same routine
                Cloud Scheduler runs weekly.
              </p>
            </div>
            <RunDigestNowButton />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
