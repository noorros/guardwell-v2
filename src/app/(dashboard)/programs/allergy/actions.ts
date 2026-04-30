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
  projectAllergyCompoundingLogged,
  projectAllergyRequirementToggled,
} from "@/lib/events/projections/allergyCompetency";
import {
  projectAllergyEquipmentCheckLogged,
  projectAllergyEquipmentCheckUpdated,
  projectAllergyEquipmentCheckDeleted,
} from "@/lib/events/projections/allergyEquipment";
import {
  projectAllergyDrillLogged,
  projectAllergyDrillUpdated,
  projectAllergyDrillDeleted,
} from "@/lib/events/projections/allergyDrill";
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

/**
 * Audit C-2 (Allergy): per-target tenant check mirrors the pattern in
 * `logCompoundingActivityAction` + `toggleStaffAllergyRequirementAction`.
 * Without it, an OWNER of Practice A could attest a competency pass
 * against Practice B's compounder via a forged practiceUserId.
 */
export async function attestFingertipTestAction(input: z.infer<typeof FingertipInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = FingertipInput.parse(input);
  const target = await db.practiceUser.findUnique({ where: { id: parsed.practiceUserId } });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Member not found");
  }
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

/** Audit C-2 (Allergy): per-target tenant check — see attestFingertipTestAction. */
export async function attestMediaFillTestAction(input: z.infer<typeof MediaFillInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = MediaFillInput.parse(input);
  const target = await db.practiceUser.findUnique({ where: { id: parsed.practiceUserId } });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Member not found");
  }
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
  const { user, pu } = await requireAdmin();
  const parsed = LogCompoundingInput.parse(input);
  const target = await db.practiceUser.findUnique({ where: { id: parsed.practiceUserId } });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Member not found");
  }
  const year = new Date().getFullYear();
  const payload = {
    practiceUserId: parsed.practiceUserId,
    year,
    loggedByPracticeUserId: pu.id,
    loggedAt: new Date().toISOString(),
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_COMPOUNDING_LOGGED",
      payload,
    },
    async (tx) => projectAllergyCompoundingLogged(tx, { practiceId: pu.practiceId, payload }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const ToggleStaffInput = z.object({
  practiceUserId: z.string().min(1),
  required: z.boolean(),
});

export async function toggleStaffAllergyRequirementAction(input: z.infer<typeof ToggleStaffInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = ToggleStaffInput.parse(input);
  const target = await db.practiceUser.findUnique({
    where: { id: parsed.practiceUserId },
    select: { practiceId: true, requiresAllergyCompetency: true },
  });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Member not found");
  }
  // No-op when the desired state already holds — avoids a stream of
  // identical EventLog rows when the UI button is double-clicked.
  if (target.requiresAllergyCompetency === parsed.required) {
    return;
  }
  const payload = {
    practiceUserId: parsed.practiceUserId,
    required: parsed.required,
    previousValue: target.requiresAllergyCompetency,
    toggledByPracticeUserId: pu.id,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_REQUIREMENT_TOGGLED",
      payload,
    },
    async (tx) => projectAllergyRequirementToggled(tx, { practiceId: pu.practiceId, payload }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/programs/staff");
}

const QuizSubmitInput = z.object({
  attemptId: z.string().min(1),
  answers: z.array(z.object({ questionId: z.string().min(1), selectedId: z.string().min(1) })),
});

/**
 * Audit C-2 (Allergy): intentionally open to STAFF/VIEWER. The compounder
 * is grading their own quiz attempt — `practiceUserId` is taken from the
 * caller's session, not from `input`, so per-target tenant escalation is
 * impossible. The role gate is on the *attestation* actions
 * (attestFingertipTestAction / attestMediaFillTestAction) which require
 * an ADMIN to mark a competency complete.
 */
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

const DrillInput = z
  .object({
    conductedAt: dateOnlyString,
    scenario: z.string().min(1).max(2000),
    // Audit #21 (IM-2): each participantId must be unique within the
    // submission. Without this refine, a forged POST could duplicate a
    // single id to inflate the participant count toward ALLERGY_ANNUAL_DRILL.
    participantIds: z
      .array(z.string().min(1))
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Participants must be unique",
      }),
    durationMinutes: z.number().int().min(0).nullable().optional(),
    observations: z.string().max(2000).nullable().optional(),
    correctiveActions: z.string().max(2000).nullable().optional(),
    nextDrillDue: dateOnlyString.nullable().optional(),
  });

/**
 * Audit #21 (Allergy IM-2): the participantIds column is a String[] without
 * FK enforcement, so a forged POST could supply an id from another practice
 * (cross-tenant data spray) or a removed member. Verify every id resolves
 * to an active member of the caller's practice before emitting the event.
 *
 * Long-term, this column should become a join table (`AllergyDrillParticipant`)
 * with proper FK + onDelete semantics — see schema TODO on AllergyDrill.
 */
async function assertParticipantsActiveMembers(
  participantIds: string[],
  practiceId: string,
): Promise<void> {
  const members = await db.practiceUser.findMany({
    where: { id: { in: participantIds }, practiceId, removedAt: null },
    select: { id: true },
  });
  if (members.length !== participantIds.length) {
    throw new Error(
      "Some participants are not active members of your practice",
    );
  }
}

export async function logDrillAction(input: z.infer<typeof DrillInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = DrillInput.parse(input);
  await assertParticipantsActiveMembers(parsed.participantIds, pu.practiceId);
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

const UpdateDrillInput = DrillInput.extend({
  drillId: z.string().min(1),
});

/**
 * Audit #15: typo correction on an existing drill row. ADMIN-gated +
 * cross-tenant checked at both the action layer (here, via practiceId
 * match) and the projection layer (via assertProjectionPracticeOwned).
 */
export async function updateDrillAction(input: z.infer<typeof UpdateDrillInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = UpdateDrillInput.parse(input);
  const existing = await db.allergyDrill.findUnique({
    where: { id: parsed.drillId },
    select: { practiceId: true, retiredAt: true },
  });
  if (!existing || existing.practiceId !== pu.practiceId) {
    throw new Error("Drill not found");
  }
  if (existing.retiredAt) {
    throw new Error("Cannot edit a retired drill");
  }
  // Audit #21 (Allergy IM-2): same FK-integrity guard as logDrillAction —
  // an edit that introduces a cross-tenant or removed-member id is just as
  // bad as creating one with such ids. Apply the same check here.
  await assertParticipantsActiveMembers(parsed.participantIds, pu.practiceId);
  const payload = {
    drillId: parsed.drillId,
    editedByUserId: pu.id,
    conductedAt: new Date(parsed.conductedAt).toISOString(),
    scenario: parsed.scenario,
    participantIds: parsed.participantIds,
    durationMinutes: parsed.durationMinutes ?? null,
    observations: parsed.observations ?? null,
    correctiveActions: parsed.correctiveActions ?? null,
    nextDrillDue: parsed.nextDrillDue
      ? new Date(parsed.nextDrillDue).toISOString()
      : null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_DRILL_UPDATED",
      payload,
    },
    async (tx) =>
      projectAllergyDrillUpdated(tx, { practiceId: pu.practiceId, payload }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const DeleteDrillInput = z.object({
  drillId: z.string().min(1),
  reason: z.string().max(500).nullable().optional(),
});

export async function deleteDrillAction(input: z.infer<typeof DeleteDrillInput>) {
  const { user, pu } = await requireAdmin();
  const parsed = DeleteDrillInput.parse(input);
  const existing = await db.allergyDrill.findUnique({
    where: { id: parsed.drillId },
    select: { practiceId: true },
  });
  if (!existing || existing.practiceId !== pu.practiceId) {
    throw new Error("Drill not found");
  }
  const payload = {
    drillId: parsed.drillId,
    deletedByUserId: pu.id,
    deletedAt: new Date().toISOString(),
    reason: parsed.reason ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_DRILL_DELETED",
      payload,
    },
    async (tx) =>
      projectAllergyDrillDeleted(tx, { practiceId: pu.practiceId, payload }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const UpdateEquipmentInput = z.object({
  equipmentCheckId: z.string().min(1),
  // checkType intentionally NOT editable — see registry comment.
  checkedAt: z.string().datetime().optional(),
  epiExpiryDate: dateOnlyString.nullable().optional(),
  epiLotNumber: z.string().max(100).nullable().optional(),
  allItemsPresent: z.boolean().nullable().optional(),
  itemsReplaced: z.string().max(2000).nullable().optional(),
  temperatureC: z.number().min(-20).max(40).nullable().optional(),
  inRange: z.boolean().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function updateEquipmentCheckAction(
  input: z.infer<typeof UpdateEquipmentInput>,
) {
  const { user, pu } = await requireAdmin();
  const parsed = UpdateEquipmentInput.parse(input);
  const existing = await db.allergyEquipmentCheck.findUnique({
    where: { id: parsed.equipmentCheckId },
    select: { practiceId: true, retiredAt: true, checkedAt: true },
  });
  if (!existing || existing.practiceId !== pu.practiceId) {
    throw new Error("Equipment check not found");
  }
  if (existing.retiredAt) {
    throw new Error("Cannot edit a retired equipment check");
  }
  const payload = {
    equipmentCheckId: parsed.equipmentCheckId,
    editedByUserId: pu.id,
    // checkedAt isn't user-editable in the inline form for now; keep the
    // original timestamp so audit replay stays stable. If we surface it
    // in a later iteration, switch to parsed.checkedAt.
    checkedAt: (parsed.checkedAt
      ? new Date(parsed.checkedAt)
      : existing.checkedAt
    ).toISOString(),
    epiExpiryDate: parsed.epiExpiryDate
      ? new Date(parsed.epiExpiryDate).toISOString()
      : null,
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
      type: "ALLERGY_EQUIPMENT_CHECK_UPDATED",
      payload,
    },
    async (tx) =>
      projectAllergyEquipmentCheckUpdated(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}

const DeleteEquipmentInput = z.object({
  equipmentCheckId: z.string().min(1),
  reason: z.string().max(500).nullable().optional(),
});

export async function deleteEquipmentCheckAction(
  input: z.infer<typeof DeleteEquipmentInput>,
) {
  const { user, pu } = await requireAdmin();
  const parsed = DeleteEquipmentInput.parse(input);
  const existing = await db.allergyEquipmentCheck.findUnique({
    where: { id: parsed.equipmentCheckId },
    select: { practiceId: true },
  });
  if (!existing || existing.practiceId !== pu.practiceId) {
    throw new Error("Equipment check not found");
  }
  const payload = {
    equipmentCheckId: parsed.equipmentCheckId,
    deletedByUserId: pu.id,
    deletedAt: new Date().toISOString(),
    reason: parsed.reason ?? null,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ALLERGY_EQUIPMENT_CHECK_DELETED",
      payload,
    },
    async (tx) =>
      projectAllergyEquipmentCheckDeleted(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/allergy");
  revalidatePath("/modules/allergy");
}
