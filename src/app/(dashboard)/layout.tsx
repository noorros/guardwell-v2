import { redirect } from "next/navigation";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { AppShell } from "@/components/gw/AppShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pu = await getPracticeUser();
  if (!pu) redirect("/onboarding/create-practice");

  // Enabled frameworks only — the practice's "My Compliance" list. Ordered by
  // the framework-level sortOrder so HIPAA/OSHA/OIG stay at the top regardless
  // of when each PracticeFramework row was enabled.
  const practiceFrameworks = await db.practiceFramework.findMany({
    where: {
      practiceId: pu.practiceId,
      enabled: true,
      disabledAt: null,
    },
    include: { framework: true },
    orderBy: { framework: { sortOrder: "asc" } },
  });

  // "Assessed" = the practice has at least one ComplianceItem row whose
  // requirement belongs to this framework. Grouped count keeps this to a
  // single DB trip regardless of the framework count.
  const assessedGroups = await db.complianceItem.groupBy({
    by: ["requirementId"],
    where: {
      practiceId: pu.practiceId,
      requirement: {
        frameworkId: { in: practiceFrameworks.map((pf) => pf.frameworkId) },
      },
    },
  });
  const assessedRequirementIds = new Set(assessedGroups.map((g) => g.requirementId));
  const requirementsByFramework = await db.regulatoryRequirement.findMany({
    where: { frameworkId: { in: practiceFrameworks.map((pf) => pf.frameworkId) } },
    select: { id: true, frameworkId: true },
  });
  const assessedFrameworkIds = new Set(
    requirementsByFramework
      .filter((r) => assessedRequirementIds.has(r.id))
      .map((r) => r.frameworkId),
  );

  const myComplianceItems = practiceFrameworks.map((pf) => ({
    code: pf.framework.code,
    name: pf.framework.name,
    shortName: pf.framework.shortName,
    score: Math.round(pf.scoreCache ?? 0),
    assessed: assessedFrameworkIds.has(pf.frameworkId),
  }));

  return (
    <AppShell
      practice={{ name: pu.practice.name }}
      user={{ email: pu.dbUser.email }}
      myComplianceItems={myComplianceItems}
    >
      {children}
    </AppShell>
  );
}
