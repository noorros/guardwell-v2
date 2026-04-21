// src/lib/events/projections/sraCompleted.ts
//
// Projects SRA_COMPLETED events. One event represents a completed HIPAA
// Security Risk Assessment — creates the PracticeSraAssessment row +
// one PracticeSraAnswer per question, then rederives HIPAA_SRA.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"SRA_COMPLETED", 1>;

export async function projectSraCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Resolve question codes to question IDs in bulk for the FK writes.
  const codes = payload.answers.map((a) => a.questionCode);
  const questions = await tx.sraQuestion.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const byCode = new Map(questions.map((q) => [q.code, q.id]));

  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new Error(`Unknown SRA question codes: ${missing.join(", ")}`);
  }

  await tx.practiceSraAssessment.create({
    data: {
      id: payload.assessmentId,
      practiceId,
      completedByUserId: payload.completedByUserId,
      overallScore: payload.overallScore,
      addressedCount: payload.addressedCount,
      totalCount: payload.totalCount,
      answers: {
        create: payload.answers.map((a) => ({
          questionId: byCode.get(a.questionCode)!,
          answer: a.answer,
          notes: a.notes ?? null,
        })),
      },
    },
  });

  await rederiveRequirementStatus(tx, practiceId, "SRA_COMPLETED");
}
