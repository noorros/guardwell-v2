// src/lib/compliance/derivation/rederive.ts
//
// Projection-side helper. After any evidence event (OFFICER_DESIGNATED,
// POLICY_ADOPTED, …) writes through appendEventAndApply, its projection
// calls rederiveRequirementStatus(tx, practiceId, evidenceTypeCode).
//
// Flow:
//   1. SELECT all RegulatoryRequirement rows whose acceptedEvidenceTypes
//      contains evidenceTypeCode.
//   2. For each: look up the derivation rule by requirement.code. Skip
//      silently if none is registered.
//   3. Run the rule. If it returns null — skip.
//   4. USER override guard: if the current ComplianceItem is COMPLIANT
//      AND the most recent REQUIREMENT_STATUS_UPDATED event for that
//      requirement has source=USER, skip (never downgrade user input).
//   5. No-op guard: if derived status equals current status, skip.
//   6. Otherwise emit a REQUIREMENT_STATUS_UPDATED event (source=DERIVED),
//      upsert the ComplianceItem, and recompute the framework score.
//
// Lives in src/lib/compliance/ not src/lib/events/, but only writes to
// projection tables via the projection helpers (EventLog.create +
// ComplianceItem.upsert + recomputeFrameworkScore). Because this file
// sits under src/lib/ — which the lint rule doesn't protect — the writes
// are allowed; the guarantee is that only projection code (under
// src/lib/events/ or its direct helpers) imports this.

import type { Prisma } from "@prisma/client";
import { DERIVATION_RULES } from "./index";
import { recomputeFrameworkScore } from "@/lib/events/projections/frameworkScore";

type EventLogPayload = { requirementId?: string; source?: string } | null;

export interface RederiveResult {
  /** Number of ComplianceItem rows whose status was derived (changed). */
  rederived: number;
}

export async function rederiveRequirementStatus(
  tx: Prisma.TransactionClient,
  practiceId: string,
  evidenceTypeCode: string,
): Promise<RederiveResult> {
  const requirements = await tx.regulatoryRequirement.findMany({
    where: { acceptedEvidenceTypes: { has: evidenceTypeCode } },
    include: { framework: true },
  });

  let rederived = 0;
  for (const req of requirements) {
    const rule = DERIVATION_RULES[req.code];
    if (!rule) continue;

    const derivedStatus = await rule(tx, practiceId);
    if (!derivedStatus) continue;

    const existing = await tx.complianceItem.findUnique({
      where: {
        practiceId_requirementId: { practiceId, requirementId: req.id },
      },
    });

    // User override: once a human has asserted COMPLIANT, derivation
    // never downgrades. The check is "current is COMPLIANT AND the most
    // recent status event was source=USER".
    if (existing?.status === "COMPLIANT") {
      const latestEvent = await tx.eventLog.findFirst({
        where: {
          practiceId,
          type: "REQUIREMENT_STATUS_UPDATED",
          AND: [
            { payload: { path: ["requirementId"], equals: req.id } },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
      const lastSource = (latestEvent?.payload as EventLogPayload)?.source;
      if (lastSource === "USER") continue;
    }

    // No-op when the derived status matches what's already stored.
    if (existing?.status === derivedStatus) continue;

    const previous = (existing?.status ?? "NOT_STARTED") as
      | "NOT_STARTED"
      | "IN_PROGRESS"
      | "COMPLIANT"
      | "GAP"
      | "NOT_APPLICABLE";

    await tx.eventLog.create({
      data: {
        practiceId,
        actorUserId: null,
        type: "REQUIREMENT_STATUS_UPDATED",
        schemaVersion: 1,
        payload: {
          requirementId: req.id,
          frameworkCode: req.framework.code,
          requirementCode: req.code,
          previousStatus: previous,
          nextStatus: derivedStatus,
          source: "DERIVED",
          reason: `Auto-derived from ${evidenceTypeCode}`,
        },
      },
    });

    await tx.complianceItem.upsert({
      where: {
        practiceId_requirementId: { practiceId, requirementId: req.id },
      },
      create: {
        practiceId,
        requirementId: req.id,
        status: derivedStatus,
      },
      update: { status: derivedStatus },
    });

    await recomputeFrameworkScore(tx, practiceId, req.framework.id);
    rederived += 1;
  }

  return { rederived };
}
