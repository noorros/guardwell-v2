// src/app/(dashboard)/programs/allergy/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectAllergyQuizCompleted,
  projectAllergyFingertipTestPassed,
  projectAllergyMediaFillPassed,
  recomputeIsFullyQualified,
} from "@/lib/events/projections/allergyCompetency";
import { projectAllergyEquipmentCheckLogged } from "@/lib/events/projections/allergyEquipment";
import { projectAllergyDrillLogged } from "@/lib/events/projections/allergyDrill";
import { db } from "@/lib/db";
import { gradeAllergyQuizAttempt, type QuizReviewItem } from "./grade";

// HTML <input type="date"> emits YYYY-MM-DD; the action converts to a
// full ISO datetime before forwarding to the event registry (which
// requires z.string().datetime()). This regex catches garbage at the
// Zod boundary rather than letting it surface later as Invalid Date.
const dateOnlyString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

async function requireAdmin() {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can manage allergy compliance");
  }
  return { user, pu };
}

const FingertipInput = z.object({
  practiceUserId: z.string().min(1),
  notes: z.string().max(2000).nullable().optional(),
});

export async function attestFingertipTestAction(input: z.infer<typeof FingertipInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = FingertipInput.parse(input);
  const year = new Date().getFullYear();
  const payload = {
    practiceUserId: parsed.practiceUserId,
    year,
    attestedByUserId: pu.id,
    notes: parsed.notes ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_FINGERTIP_TEST_PASSED",
      payload,
    },
    async (tx) => projectAllergyFingertipTestPassed(tx, { practiceId: pu.practiceId, payload }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const MediaFillInput = z.object({
  practiceUserId: z.string().min(1),
  notes: z.string().max(2000).nullable().optional(),
});

export async function attestMediaFillTestAction(input: z.infer<typeof MediaFillInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = MediaFillInput.parse(input);
  const year = new Date().getFullYear();
  const payload = {
    practiceUserId: parsed.practiceUserId,
    year,
    attestedByUserId: pu.id,
    notes: parsed.notes ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_MEDIA_FILL_PASSED",
      payload,
    },
    async (tx) => projectAllergyMediaFillPassed(tx, { practiceId: pu.practiceId, payload }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const LogCompoundingInput = z.object({
  practiceUserId: z.string().min(1),
});

export async function logCompoundingActivityAction(input: z.infer<typeof LogCompoundingInput>) {
  const { pu } = await requireAdmin();
  const parsed = LogCompoundingInput.parse(input);
  const target = await db.practiceUser.findUnique({ where: { id: parsed.practiceUserId } });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Member not found");
  }
  const year = new Date().getFullYear();
  const comp = await db.allergyCompetency.upsert({
    where: {
      practiceUserId_year: { practiceUserId: parsed.practiceUserId, year },
    },
    create: {
      practiceId: pu.practiceId,
      practiceUserId: parsed.practiceUserId,
      year,
      lastCompoundedAt: new Date(),
    },
    update: {
      lastCompoundedAt: new Date(),
    },
    select: { id: true },
  });
  // Recompute qualification status — logging a session may clear inactivity.
  await db.$transaction(async (tx) => {
    await recomputeIsFullyQualified(tx, comp.id);
  });
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const ToggleStaffInput = z.object({
  practiceUserId: z.string().min(1),
  required: z.boolean(),
});

export async function toggleStaffAllergyRequirementAction(input: z.infer<typeof ToggleStaffInput>) {
  const { pu } = await requireAdmin();
  const parsed = ToggleStaffInput.parse(input);
  const target = await db.practiceUser.findUnique({ where: { id: parsed.practiceUserId } });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Member not found");
  }
  await db.practiceUser.update({
    where: { id: parsed.practiceUserId },
    data: { requiresAllergyCompetency: parsed.required },
  });
  revalidatePath("/programs/allergy");
  revalidatePath("/programs/staff");
}

const QuizSubmitInput = z.object({
  attemptId: z.string().min(1),
  answers: z.array(z.object({ questionId: z.string().min(1), selectedId: z.string().min(1) })),
});

export async function submitQuizAttemptAction(
  input: z.infer<typeof QuizSubmitInput>,
): Promise<{
  score: number;
  passed: boolean;
  reviewItems: QuizReviewItem[];
}> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = QuizSubmitInput.parse(input);

  const graded = await gradeAllergyQuizAttempt(db, { answers: parsed.answers });
  const year = new Date().getFullYear();

  const payload = {
    attemptId: parsed.attemptId,
    practiceUserId: pu.id,
    year,
    score: graded.score,
    passed: graded.passed,
    correctAnswers: graded.correctAnswers,
    totalQuestions: graded.totalQuestions,
    answers: graded.annotated,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_QUIZ_COMPLETED",
      payload,
    },
    async (tx) => projectAllergyQuizCompleted(tx, { practiceId: pu.practiceId, payload }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
  return {
    score: graded.score,
    passed: graded.passed,
    reviewItems: graded.reviewItems,
  };
}

const EquipmentInput = z.object({
  checkType: z.enum(["EMERGENCY_KIT", "REFRIGERATOR_TEMP", "SKIN_TEST_SUPPLIES"]),
  epiExpiryDate: dateOnlyString.nullable().optional(),
  epiLotNumber: z.string().max(100).nullable().optional(),
  allItemsPresent: z.boolean().nullable().optional(),
  itemsReplaced: z.string().max(2000).nullable().optional(),
  temperatureC: z.number().min(-20).max(40).nullable().optional(),
  inRange: z.boolean().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function logEquipmentCheckAction(input: z.infer<typeof EquipmentInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = EquipmentInput.parse(input);
  const equipmentCheckId = randomUUID();
  const payload = {
    equipmentCheckId,
    checkType: parsed.checkType,
    checkedByUserId: pu.id,
    checkedAt: new Date().toISOString(),
    epiExpiryDate: parsed.epiExpiryDate ? new Date(parsed.epiExpiryDate).toISOString() : null,
    epiLotNumber: parsed.epiLotNumber ?? null,
    allItemsPresent: parsed.allItemsPresent ?? null,
    itemsReplaced: parsed.itemsReplaced ?? null,
    temperatureC: parsed.temperatureC ?? null,
    inRange: parsed.inRange ?? null,
    notes: parsed.notes ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_EQUIPMENT_CHECK_LOGGED",
      payload,
    },
    async (tx) => projectAllergyEquipmentCheckLogged(tx, { practiceId: pu.practiceId, payload }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const DrillInput = z.object({
  conductedAt: dateOnlyString,
  scenario: z.string().min(1).max(2000),
  participantIds: z.array(z.string().min(1)).min(1),
  durationMinutes: z.number().int().min(0).nullable().optional(),
  observations: z.string().max(2000).nullable().optional(),
  correctiveActions: z.string().max(2000).nullable().optional(),
  nextDrillDue: dateOnlyString.nullable().optional(),
});

export async function logDrillAction(input: z.infer<typeof DrillInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = DrillInput.parse(input);
  const drillId = randomUUID();
  const payload = {
    drillId,
    conductedByUserId: pu.id,
    conductedAt: new Date(parsed.conductedAt).toISOString(),
    scenario: parsed.scenario,
    participantIds: parsed.participantIds,
    durationMinutes: parsed.durationMinutes ?? null,
    observations: parsed.observations ?? null,
    correctiveActions: parsed.correctiveActions ?? null,
    nextDrillDue: parsed.nextDrillDue ? new Date(parsed.nextDrillDue).toISOString() : null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_DRILL_LOGGED",
      payload,
    },
    async (tx) => projectAllergyDrillLogged(tx, { practiceId: pu.practiceId, payload }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}
