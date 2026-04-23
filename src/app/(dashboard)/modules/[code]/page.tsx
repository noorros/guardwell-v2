// src/app/(dashboard)/modules/[code]/page.tsx
import { notFound } from "next/navigation";
import { ShieldCheck, FileText } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
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
import type { AiReasonSource } from "@/components/gw/ChecklistItem/AiReasonIndicator";
import {
  getPracticeJurisdictions,
  requirementAppliesToJurisdictions,
} from "@/lib/compliance/jurisdictions";

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

  // State-overlay filter: keep federal requirements (empty jurisdictionFilter)
  // and any state-specific requirements that match this practice's
  // primaryState + operatingStates. CA-only requirements stay hidden for an
  // AZ-only practice, visible for a CA practice or a multi-state CA+AZ one.
  const jurisdictions = getPracticeJurisdictions(pu.practice);
  const applicableRequirements = framework.requirements.filter((r) =>
    requirementAppliesToJurisdictions(r, jurisdictions),
  );

  const items = await db.complianceItem.findMany({
    where: {
      practiceId: pu.practiceId,
      requirementId: { in: applicableRequirements.map((r) => r.id) },
    },
  });
  const byReq = new Map(items.map((i) => [i.requirementId, i]));

  // Section B counts, computed pre-status-filter so the band always shows the
  // true shape across requirements applicable to this practice.
  const compliantCount = items.filter((i) => i.status === "COMPLIANT").length;
  const totalRequirements = applicableRequirements.length;
  const gapCount = items.filter((i) => i.status === "GAP").length;
  const deadlineCount = 0; // Placeholder — no deadline source until operational pages.

  // Apply Section-C status filter from Section-B click: ?status=compliant|gap|not-started.
  // Unknown values fall through to "show all".
  const statusFilter = sp.status?.toLowerCase();
  const filteredRequirements = applicableRequirements.filter((r) => {
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

  // Section E — status-change events for this framework. Fetch a larger
  // window (40) so we can dedupe consecutive toggles by the same actor on
  // the same requirement within a 5-minute window, then trim to 10 rows for
  // display. This keeps the feed tight when a user flips a requirement
  // back-and-forth while investigating.
  const DEDUP_WINDOW_MS = 5 * 60 * 1000;
  const rawActivityEvents = await db.eventLog.findMany({
    where: {
      practiceId: pu.practiceId,
      type: "REQUIREMENT_STATUS_UPDATED",
      // Filter on JSON payload: frameworkCode === framework.code
      // Postgres JSON path filter:
      AND: [{ payload: { path: ["frameworkCode"], equals: framework.code } }],
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { actor: { select: { email: true } } },
  });

  // Dedup pass: newest-first. Drop an event when the event that immediately
  // precedes it in the kept list (i.e. a newer entry by the same actor on
  // the same requirement) is within DEDUP_WINDOW_MS. We keep the newest —
  // the loop visits newest first and decides to keep or skip.
  const dedupedActivity: typeof rawActivityEvents = [];
  for (const evt of rawActivityEvents) {
    const payload = evt.payload as StatusEventPayload | null;
    const reqId = payload?.requirementId ?? null;
    const lastKept = dedupedActivity[dedupedActivity.length - 1];
    if (lastKept) {
      const lastPayload = lastKept.payload as StatusEventPayload | null;
      const lastReqId = lastPayload?.requirementId ?? null;
      const sameActor = lastKept.actorUserId === evt.actorUserId;
      const sameReq = lastReqId !== null && lastReqId === reqId;
      const gap = lastKept.createdAt.getTime() - evt.createdAt.getTime();
      if (sameActor && sameReq && gap < DEDUP_WINDOW_MS) {
        // Skip this older duplicate; the newer one is already kept.
        continue;
      }
    }
    dedupedActivity.push(evt);
    if (dedupedActivity.length >= 10) break;
  }

  const distinctActorCount = new Set(
    dedupedActivity.map((e) => e.actorUserId),
  ).size;

  const requirementById = new Map(applicableRequirements.map((r) => [r.id, r]));
  const feedEvents: ModuleActivityEvent[] = dedupedActivity.map((evt) => {
    const payload = evt.payload as StatusEventPayload | null;
    const reqId = payload?.requirementId ?? "";
    const req = requirementById.get(reqId);
    return {
      id: evt.id,
      createdAt: evt.createdAt,
      requirementTitle: req?.title ?? "Requirement",
      nextStatus: payload?.nextStatus ?? "NOT_STARTED",
      actorUserId: evt.actorUserId,
      actorEmail: evt.actor?.email ?? null,
      source: payload?.source ?? null,
      reason: payload?.reason ?? null,
    };
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Compliance", href: "/modules" },
          { label: framework.name },
        ]}
      />
      <ModuleHeader
        icon={ShieldCheck}
        name={framework.name}
        citation={framework.citation ?? undefined}
        score={score}
        jurisdictions={[framework.jurisdiction]}
        assessedAt={pf?.lastScoredAt ?? null}
        assessed={items.length > 0}
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
                jurisdictionFilter={r.jurisdictionFilter}
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
          action={{
            label: "Go to My Programs (coming soon)",
            href: "#",
            disabled: true,
          }}
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Recent activity</h2>
        <ModuleActivityFeed
          events={feedEvents}
          currentUserId={pu.dbUser.id}
          distinctActorCount={distinctActorCount}
        />
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
