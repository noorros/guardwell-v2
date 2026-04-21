import Link from "next/link";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { ComplianceCard } from "@/components/gw/ComplianceCard";
import { EmptyState } from "@/components/gw/EmptyState";
import { Inbox } from "lucide-react";

export const metadata = { title: "My Compliance · GuardWell" };

export default async function ModulesIndexPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  // Show every framework with a sort_order, even if the practice has not
  // activated it yet. PracticeFramework rows drive enable/disable; for
  // week 5 we render them all and link to the module page which lazily
  // creates a PracticeFramework row on first load.
  const frameworks = await db.regulatoryFramework.findMany({
    orderBy: { sortOrder: "asc" },
  });

  if (frameworks.length === 0) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={Inbox}
          title="No frameworks loaded"
          description="Run `npm run db:seed` to seed the regulatory framework content."
        />
      </main>
    );
  }

  const pfs = await db.practiceFramework.findMany({
    where: { practiceId: pu.practiceId },
  });
  const scoreByFramework = new Map(pfs.map((p) => [p.frameworkId, p.scoreCache ?? 0]));

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">My Compliance</h1>
        <p className="text-sm text-muted-foreground">
          One module per regulatory framework. Click to see requirements.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {frameworks.map((f) => (
          <Link key={f.id} href={`/modules/${f.code.toLowerCase()}`}>
            <ComplianceCard
              title={f.name}
              subtitle={f.citation ?? undefined}
              score={scoreByFramework.get(f.id) ?? 0}
            />
          </Link>
        ))}
      </div>
    </main>
  );
}
