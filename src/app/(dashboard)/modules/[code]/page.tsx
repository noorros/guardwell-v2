// src/app/(dashboard)/modules/[code]/page.tsx
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/gw/ModuleHeader";
import { AiAssistTrigger } from "@/components/gw/AiAssistDrawer/AiAssistTrigger";
import { ChecklistItemServer } from "./ChecklistItemServer";
import { AiAssessmentButton } from "./AiAssessmentButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return { title: `${code.toUpperCase()} · My Compliance` };
}

export default async function ModulePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const pu = await getPracticeUser();
  if (!pu) return null;

  const framework = await db.regulatoryFramework.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      requirements: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!framework) notFound();

  const items = await db.complianceItem.findMany({
    where: {
      practiceId: pu.practiceId,
      requirementId: { in: framework.requirements.map((r) => r.id) },
    },
  });
  const byReq = new Map(items.map((i) => [i.requirementId, i]));

  const pf = await db.practiceFramework.findUnique({
    where: {
      practiceId_frameworkId: {
        practiceId: pu.practiceId,
        frameworkId: framework.id,
      },
    },
  });
  const score = pf?.scoreCache ?? 0;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <ModuleHeader
        icon={ShieldCheck}
        name={framework.name}
        citation={framework.citation ?? undefined}
        score={score}
        jurisdictions={[framework.jurisdiction]}
      />
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Requirements</h2>
          <div className="flex items-center gap-2">
            <AiAssistTrigger
              pageContext={{
                route: `/modules/${framework.code.toLowerCase()}`,
                summary: `${framework.name} requirements for ${pu.practice.name}`,
              }}
            />
            <AiAssessmentButton frameworkCode={framework.code} />
          </div>
        </div>
        <div className="space-y-2">
          {framework.requirements.map((r) => {
            const ci = byReq.get(r.id);
            return (
              <ChecklistItemServer
                key={r.id}
                frameworkCode={framework.code}
                requirementId={r.id}
                requirementCode={r.code}
                title={r.title}
                description={r.citation ?? undefined}
                initialStatus={ciStatusToChecklist(ci?.status)}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}

function ciStatusToChecklist(
  s: string | undefined,
): "compliant" | "gap" | "not_started" {
  if (s === "COMPLIANT") return "compliant";
  if (s === "GAP") return "gap";
  return "not_started";
}
