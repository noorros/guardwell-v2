import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PracticeIdentityCard } from "@/components/gw/PracticeIdentityCard";
import { EmptyState } from "@/components/gw/EmptyState";
import { Inbox } from "lucide-react";

export const metadata = {
  title: "Dashboard · GuardWell",
};

export default async function DashboardPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const eventCount = await db.eventLog.count({
    where: { practiceId: pu.practiceId },
  });

  const officerRoles: Array<"Privacy Officer" | "Security Officer" | "Compliance Officer"> = [];
  if (pu.isPrivacyOfficer) officerRoles.push("Privacy Officer");
  if (pu.isComplianceOfficer) officerRoles.push("Compliance Officer");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
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
