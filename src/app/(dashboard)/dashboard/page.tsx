import Link from "next/link";
import type { Route } from "next";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PracticeIdentityCard } from "@/components/gw/PracticeIdentityCard";
import { EmptyState } from "@/components/gw/EmptyState";
import {
  MajorBreachBanner,
  MAJOR_BREACH_THRESHOLD,
} from "@/components/gw/MajorBreachBanner";
import { Inbox } from "lucide-react";
import { FirstRunReminderBanner } from "./FirstRunReminderBanner";

export const metadata = {
  title: "Dashboard · GuardWell",
};

// HHS OCR: notification required within 60 days of discovery. Deadline =
// discoveredAt + 60d.
const OCR_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export default async function DashboardPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const [eventCount, majorBreach, practiceMeta] = await Promise.all([
    db.eventLog.count({ where: { practiceId: pu.practiceId } }),
    // Surface the most imminent unresolved major breach (500+ individuals).
    // Sorted by soonest discovery so the closest-to-deadline breach wins.
    db.incident.findFirst({
      where: {
        practiceId: pu.practiceId,
        isBreach: true,
        resolvedAt: null,
        affectedCount: { gte: MAJOR_BREACH_THRESHOLD },
      },
      orderBy: { discoveredAt: "asc" },
      select: {
        id: true,
        affectedCount: true,
        discoveredAt: true,
      },
    }),
    db.practice.findUniqueOrThrow({
      where: { id: pu.practiceId },
      select: { firstRunCompletedAt: true },
    }),
  ]);

  const officerRoles: Array<"Privacy Officer" | "Security Officer" | "Compliance Officer"> = [];
  if (pu.isPrivacyOfficer) officerRoles.push("Privacy Officer");
  if (pu.isSecurityOfficer) officerRoles.push("Security Officer");
  if (pu.isComplianceOfficer) officerRoles.push("Compliance Officer");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      {!practiceMeta.firstRunCompletedAt && <FirstRunReminderBanner />}
      {majorBreach && (
        <Link
          href={`/programs/incidents/${majorBreach.id}` as Route}
          className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <MajorBreachBanner
            affectedCount={majorBreach.affectedCount ?? 0}
            reportingDeadline={
              new Date(majorBreach.discoveredAt.getTime() + OCR_WINDOW_MS)
            }
          />
        </Link>
      )}
      <PracticeIdentityCard
        name={pu.practice.name}
        primaryState={pu.practice.primaryState}
        role={pu.role}
        officerRoles={officerRoles}
        setupProgress={eventCount > 0 ? 10 : 0}
      />
      {eventCount === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No activity yet"
          description="As you complete compliance items, they'll show up here."
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Events recorded for this practice: {eventCount}
        </p>
      )}
    </main>
  );
}
