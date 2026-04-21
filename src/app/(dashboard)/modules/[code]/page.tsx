// src/app/(dashboard)/modules/[code]/page.tsx
import { notFound } from "next/navigation";
import { ShieldCheck, FileText } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/gw/ModuleHeader";
import { ModuleSummaryBand } from "@/components/gw/ModuleSummaryBand";
import { EmptyState } from "@/components/gw/EmptyState";
import {
  ModuleActivityFeed,
  type ModuleActivityEvent,
  type ActivityStatus,
} from "@/components/gw/ModuleActivityFeed";
import { AiAssistTrigger } from "@/components/gw/AiAssistDrawer/AiAssistTrigger";
import { ChecklistItemServer } from "./ChecklistItemServer";
import { AiAssessmentButton } from "./AiAssessmentButton";
import type { AiReasonSource } from "@/components/gw/ChecklistItem/AiReasonIndicator";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return { title: `${code.toUpperCase()} · My Compliance` };
}

type StatusEventPayload = {
  requirementId?: string;
  frameworkCode?: string;
  source?: AiReasonSource;
  reason?: string;
  nextStatus?: ActivityStatus;
};

export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams?: Promise<{ status?: string }>;
}) {
  const { code } = await params;
  const sp = (await searchParams) ?? {};
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

  // Section B counts, computed pre-filter so the band always shows the true shape.
  const compliantCount = items.filter((i) => i.status === "COMPLIANT").length;
  const totalRequirements = framework.requirements.length;
  const gapCount = items.filter((i) => i.status === "GAP").length;
  const deadlineCount = 0; // Placeholder — no deadline source until operational pages.

  // Apply Section-C status filter from Section-B click: ?status=compliant|gap|not-started.
  // Unknown values fall through to "show all".
  const statusFilter = sp.status?.toLowerCase();
  const filteredRequirements = framework.requirements.filter((r) => {
    if (statusFilter === "compliant") {
      return byReq.get(r.id)?.status === "COMPLIANT";
    }
    if (statusFilter === "gap") {
      return byReq.get(r.id)?.status === "GAP";
    }
    if (statusFilter === "not-started") {
      const s = byReq.get(r.id)?.status;
      return s === undefined || s === "NOT_STARTED";
    }
    return true;
  });

  // Pull the most recent REQUIREMENT_STATUS_UPDATED events for this practice,
  // then keep only the latest one per requirement. 10 requirements per module
  // so a small window (last 200) reliably covers every requirement's latest.
  const recentEvents = await db.eventLog.findMany({
    where: {
      practiceId: pu.practiceId,
      type: "REQUIREMENT_STATUS_UPDATED",
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const latestEventByReq = new Map<
    string,
    { source: AiReasonSource; reason: string | null }
  >();
  for (const evt of recentEvents) {
    const payload = evt.payload as StatusEventPayload | null;
    const reqId = payload?.requirementId;
    if (!reqId) continue;
    if (latestEventByReq.has(reqId)) continue; // already have the newest (desc order)
    latestEventByReq.set(reqId, {
      source: payload?.source ?? null,
      reason: payload?.reason ?? null,
    });
  }

  const pf = await db.practiceFramework.findUnique({
    where: {
      practiceId_frameworkId: {
        practiceId: pu.practiceId,
        frameworkId: framework.id,
      },
    },
  });
  const score = pf?.scoreCache ?? 0;

  // Section E — last 10 status-change events for this framework.
  const activityEvents = await db.eventLog.findMany({
    where: {
      practiceId: pu.practiceId,
      type: "REQUIREMENT_STATUS_UPDATED",
      // Filter on JSON payload: frameworkCode === framework.code
      // Postgres JSON path filter:
      AND: [{ payload: { path: ["frameworkCode"], equals: framework.code } }],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { actor: { select: { email: true } } },
  });

  const requirementById = new Map(framework.requirements.map((r) => [r.id, r]));
  const feedEvents: ModuleActivityEvent[] = activityEvents.map((evt) => {
    const payload = evt.payload as StatusEventPayload | null;
    const reqId = payload?.requirementId ?? "";
    const req = requirementById.get(reqId);
    return {
      id: evt.id,
      createdAt: evt.createdAt,
      requirementTitle: req?.title ?? "Requirement",
      nextStatus: payload?.nextStatus ?? "NOT_STARTED",
      actorEmail: evt.actor?.email ?? null,
      reason: payload?.reason ?? null,
    };
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <ModuleHeader
        icon={ShieldCheck}
        name={framework.name}
        citation={framework.citation ?? undefined}
        score={score}
        jurisdictions={[framework.jurisdiction]}
      />
      <ModuleSummaryBand
        compliantCount={compliantCount}
        totalRequirements={totalRequirements}
        gapCount={gapCount}
        deadlineCount={deadlineCount}
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
          {filteredRequirements.map((r) => {
            const ci = byReq.get(r.id);
            const lastEvt = latestEventByReq.get(r.id);
            return (
              <ChecklistItemServer
                key={r.id}
                frameworkCode={framework.code}
                requirementId={r.id}
                requirementCode={r.code}
                title={r.title}
                description={r.citation ?? undefined}
                initialStatus={ciStatusToChecklist(ci?.status)}
                lastEventSource={lastEvt?.source ?? null}
                lastEventReason={lastEvt?.reason ?? null}
              />
            );
          })}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Evidence</h2>
        <EmptyState
          icon={FileText}
          title="No linked evidence yet"
          description="Evidence from policies, training, BAAs, and other operational surfaces will appear here once those pages ship. Requirements can still be marked compliant manually above."
          action={{ label: "Go to My Programs (coming soon)", href: "#" }}
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Recent activity</h2>
        <ModuleActivityFeed events={feedEvents} />
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
