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

  const myComplianceItems = practiceFrameworks.map((pf) => ({
    code: pf.framework.code,
    name: pf.framework.name,
    shortName: pf.framework.shortName,
    score: Math.round(pf.scoreCache ?? 0),
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
