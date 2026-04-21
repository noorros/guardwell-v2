// src/lib/events/projections/trainingCompleted.ts
//
// Projects TRAINING_COMPLETED events. Every attempt creates a new
// TrainingCompletion row — failed attempts are persisted too, so practices
// have an audit trail. Derivation only counts the latest passed-and-unexpired
// completion per (userId, courseId) toward compliance, so old failures never
// block a later pass.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"TRAINING_COMPLETED", 1>;

export async function projectTrainingCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;

  await tx.trainingCompletion.create({
    data: {
      id: payload.trainingCompletionId,
      practiceId,
      userId: payload.userId,
      courseId: payload.courseId,
      courseVersion: payload.courseVersion,
      score: payload.score,
      passed: payload.passed,
      expiresAt: new Date(payload.expiresAt),
    },
  });

  // Only passed, unexpired completions contribute to compliance derivation.
  // Still rederive even on failures so the UI stays consistent if a prior
  // pass has since expired — the rule re-evaluates the whole workforce.
  await rederiveRequirementStatus(
    tx,
    practiceId,
    `TRAINING:${payload.courseCode}`,
  );
}
