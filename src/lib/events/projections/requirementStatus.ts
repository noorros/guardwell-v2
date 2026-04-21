// src/lib/events/projections/requirementStatus.ts
//
// Projects REQUIREMENT_STATUS_UPDATED events into ComplianceItem rows and
// recomputes the PracticeFramework scoreCache/scoreLabel in the same
// transaction so the module page header always reflects the latest state.
// Called inside the appendEventAndApply transaction via the projection
// callback the server action passes.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { scoreToLabel } from "@/lib/utils";

type Payload = PayloadFor<"REQUIREMENT_STATUS_UPDATED", 1>;

export async function projectRequirementStatusUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  // Upsert the ComplianceItem. Unique on (practiceId, requirementId).
  await tx.complianceItem.upsert({
    where: {
      practiceId_requirementId: {
        practiceId,
        requirementId: payload.requirementId,
      },
    },
    update: {
      status: payload.nextStatus,
    },
    create: {
      practiceId,
      requirementId: payload.requirementId,
      status: payload.nextStatus,
    },
  });

  // Resolve the framework via the requirement so we don't trust payload-only
  // data for our scoring key.
  const requirement = await tx.regulatoryRequirement.findUnique({
    where: { id: payload.requirementId },
    select: { frameworkId: true },
  });
  if (!requirement) return;
  const { frameworkId } = requirement;

  const totalCount = await tx.regulatoryRequirement.count({
    where: { frameworkId },
  });
  if (totalCount === 0) return;

  const compliantCount = await tx.complianceItem.count({
    where: {
      practiceId,
      status: "COMPLIANT",
      requirement: { frameworkId },
    },
  });

  const score = Math.round((compliantCount / totalCount) * 100);
  const label = scoreToLabel(score);
  const now = new Date();

  await tx.practiceFramework.upsert({
    where: {
      practiceId_frameworkId: {
        practiceId,
        frameworkId,
      },
    },
    update: {
      scoreCache: score,
      scoreLabel: label,
      lastScoredAt: now,
    },
    create: {
      practiceId,
      frameworkId,
      enabled: true,
      enabledAt: now,
      scoreCache: score,
      scoreLabel: label,
      lastScoredAt: now,
    },
  });
}
