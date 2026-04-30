// src/app/(dashboard)/programs/policies/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser, requireRole } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectPolicyAdopted,
  projectPolicyRetired,
  projectPolicyReviewed,
} from "@/lib/events/projections/policyAdopted";
import { projectPolicyContentUpdated } from "@/lib/events/projections/policyContentUpdated";
import { projectPolicyAcknowledged } from "@/lib/events/projections/policyAcknowledged";
import { getRequiredCourseCodesForPolicy } from "@/lib/compliance/policy-prereqs";
import { ALL_POLICY_CODES } from "@/lib/compliance/policies";
import { db } from "@/lib/db";

const AdoptInput = z.object({
  policyCode: z.enum(ALL_POLICY_CODES),
});

const RetireInput = z.object({
  practicePolicyId: z.string().min(1),
});

/**
 * Audit C-2 (HIPAA): gated to ADMIN+. Adopting a policy adds it to the
 * practice's compliance shelf and flips a regulatory-requirement gap to
 * COMPLIANT — STAFF/VIEWER could falsely satisfy framework rules.
 */
export async function adoptPolicyAction(input: z.infer<typeof AdoptInput>) {
  const pu = await requireRole("ADMIN");
  const user = pu.dbUser;
  const parsed = AdoptInput.parse(input);

  // Reuse existing row if this practice already has the policy (retired or active).
  const existing = await db.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId: pu.practiceId,
        policyCode: parsed.policyCode,
      },
    },
  });
  const practicePolicyId = existing?.id ?? randomUUID();
  const version = existing ? existing.version : 1;

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "POLICY_ADOPTED",
      payload: {
        practicePolicyId,
        policyCode: parsed.policyCode,
        version,
      },
    },
    async (tx) =>
      projectPolicyAdopted(tx, {
        practiceId: pu.practiceId,
        payload: {
          practicePolicyId,
          policyCode: parsed.policyCode,
          version,
        },
      }),
  );

  revalidatePath("/programs/policies");
  revalidatePath("/modules/hipaa");
}

const ReviewInput = z.object({
  practicePolicyId: z.string().min(1),
});

/**
 * Audit C-2 (HIPAA): gated to ADMIN+. Marking a policy reviewed resets
 * the §164.316(b)(2)(iii) review clock — STAFF/VIEWER could fake an
 * annual review to mask a real overdue policy.
 */
export async function reviewPolicyAction(input: z.infer<typeof ReviewInput>) {
  const pu = await requireRole("ADMIN");
  const user = pu.dbUser;
  const parsed = ReviewInput.parse(input);

  const target = await db.practicePolicy.findUnique({
    where: { id: parsed.practicePolicyId },
    select: { id: true, practiceId: true, policyCode: true, retiredAt: true },
  });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Unauthorized: policy not in your practice");
  }
  if (target.retiredAt) {
    throw new Error("Cannot review a retired policy. Re-adopt first.");
  }

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "POLICY_REVIEWED",
      payload: {
        practicePolicyId: target.id,
        policyCode: target.policyCode,
        reviewedByUserId: user.id,
      },
    },
    async (tx) =>
      projectPolicyReviewed(tx, {
        practiceId: pu.practiceId,
        payload: {
          practicePolicyId: target.id,
          policyCode: target.policyCode,
          reviewedByUserId: user.id,
        },
      }),
  );

  revalidatePath("/programs/policies");
  revalidatePath("/modules/hipaa");
}

// ────────────────────────────────────────────────────────────────────────
// Catalog adoption — adopt any PolicyTemplate by code (2026-04-24)
// ────────────────────────────────────────────────────────────────────────
//
// Bridges the new 130-template catalog (PolicyTemplate model) into the
// existing PracticePolicy adoption pipeline. Templates outside the
// 9-code "core" set don't satisfy any RegulatoryRequirement (their
// codes aren't in any acceptedEvidenceTypes), so rederive is a no-op
// for them — adoption just adds them to the practice's adopted-policies
// shelf with a copy of the template body as starting content.

const AdoptFromTemplateInput = z.object({
  templateCode: z.string().min(1).max(200),
});

/** Audit C-2 (HIPAA): gated to ADMIN+ — see adoptPolicyAction. */
export async function adoptPolicyFromTemplateAction(
  input: z.infer<typeof AdoptFromTemplateInput>,
) {
  const pu = await requireRole("ADMIN");
  const user = pu.dbUser;
  const parsed = AdoptFromTemplateInput.parse(input);

  const template = await db.policyTemplate.findUnique({
    where: { code: parsed.templateCode },
    select: { code: true, bodyMarkdown: true, title: true },
  });
  if (!template) {
    throw new Error(`Policy template ${parsed.templateCode} not found`);
  }

  // Reuse existing PracticePolicy row if this template was previously
  // adopted (or retired); otherwise create new.
  const existing = await db.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId: pu.practiceId,
        policyCode: template.code,
      },
    },
  });
  const practicePolicyId = existing?.id ?? randomUUID();
  const version = existing ? existing.version : 1;

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "POLICY_ADOPTED",
      payload: {
        practicePolicyId,
        policyCode: template.code,
        version,
      },
    },
    async (tx) => {
      await projectPolicyAdopted(tx, {
        practiceId: pu.practiceId,
        payload: {
          practicePolicyId,
          policyCode: template.code,
          version,
        },
      });
      // Initialize the content from the template body — only on first
      // adoption (preserve user edits if they re-adopted a previously
      // edited policy).
      if (!existing || !existing.content) {
        await tx.practicePolicy.update({
          where: { id: practicePolicyId },
          data: { content: template.bodyMarkdown },
        });
      }
    },
  );

  revalidatePath("/programs/policies");
  revalidatePath("/modules/hipaa");
}

// ────────────────────────────────────────────────────────────────────────
// Edit adopted policy content (2026-04-24 evening)
// ────────────────────────────────────────────────────────────────────────
//
// /programs/policies/[id] uses this. Save bumps version + sets
// lastReviewedAt = now (save IS review). Records a
// POLICY_CONTENT_UPDATED event whose payload carries metadata only;
// the full content is passed to the projection separately so the
// EventLog payload stays small.

const UpdateContentInput = z.object({
  practicePolicyId: z.string().min(1),
  // 200KB cap matches our @react-pdf rendering ceiling for one policy.
  content: z.string().min(1).max(200_000),
});

/**
 * Audit C-2 (HIPAA): gated to ADMIN+. Editing policy content bumps the
 * version number and wipes prior acknowledgments (each version requires
 * a fresh ack) — STAFF/VIEWER could trash a policy's ack coverage by
 * making a no-op edit.
 */
export async function updatePolicyContentAction(
  input: z.infer<typeof UpdateContentInput>,
) {
  const pu = await requireRole("ADMIN");
  const user = pu.dbUser;
  const parsed = UpdateContentInput.parse(input);

  const target = await db.practicePolicy.findUnique({
    where: { id: parsed.practicePolicyId },
    select: {
      id: true,
      practiceId: true,
      policyCode: true,
      version: true,
      retiredAt: true,
    },
  });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Policy not found");
  }
  if (target.retiredAt) {
    throw new Error("Cannot edit a retired policy. Re-adopt first.");
  }

  const newVersion = target.version + 1;

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "POLICY_CONTENT_UPDATED",
      payload: {
        practicePolicyId: target.id,
        policyCode: target.policyCode,
        newVersion,
        contentLength: parsed.content.length,
        editedByUserId: user.id,
      },
    },
    async (tx) =>
      projectPolicyContentUpdated(tx, {
        practiceId: pu.practiceId,
        payload: {
          practicePolicyId: target.id,
          policyCode: target.policyCode,
          newVersion,
          contentLength: parsed.content.length,
          editedByUserId: user.id,
        },
        content: parsed.content,
      }),
  );

  revalidatePath("/programs/policies");
  revalidatePath(`/programs/policies/${target.id}`);
  revalidatePath("/modules/hipaa");
}

// ────────────────────────────────────────────────────────────────────────
// Per-user policy acknowledgment (2026-04-24 evening)
// ────────────────────────────────────────────────────────────────────────
//
// User clicks Acknowledge on a policy detail page → server action checks:
//   1. Policy exists + belongs to user's practice + isn't retired
//   2. User has completed every prerequisite course (passed +
//      non-expired) per POLICY_PREREQ_COURSES
//   3. User hasn't already acknowledged THIS version
// Then emits POLICY_ACKNOWLEDGED → projection writes the row +
// rederives HIPAA_POLICY_ACKNOWLEDGMENT_COVERAGE.

const AcknowledgeInput = z.object({
  practicePolicyId: z.string().min(1),
  signatureText: z.string().min(1).max(500),
});

/**
 * Audit C-2 (HIPAA): intentionally open to STAFF/VIEWER. Each user
 * acknowledges policies with their own signature — the action records
 * the caller's id (`user.id`), not an input-supplied id, so per-target
 * escalation is impossible. Restricting this would block the
 * §164.530(b)(1) workforce-training-and-acknowledgment requirement.
 */
export async function acknowledgePolicyAction(
  input: z.infer<typeof AcknowledgeInput>,
) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = AcknowledgeInput.parse(input);

  const policy = await db.practicePolicy.findUnique({
    where: { id: parsed.practicePolicyId },
    select: {
      id: true,
      practiceId: true,
      policyCode: true,
      version: true,
      retiredAt: true,
    },
  });
  if (!policy || policy.practiceId !== pu.practiceId) {
    throw new Error("Policy not found");
  }
  if (policy.retiredAt) {
    throw new Error("Cannot acknowledge a retired policy.");
  }

  // Already-acked-this-version guard.
  const existing = await db.policyAcknowledgment.findUnique({
    where: {
      practicePolicyId_userId_policyVersion: {
        practicePolicyId: policy.id,
        userId: user.id,
        policyVersion: policy.version,
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error(`You have already acknowledged v${policy.version}.`);
  }

  // Prerequisite-course gate.
  const requiredCourseCodes = getRequiredCourseCodesForPolicy(
    policy.policyCode,
  );
  if (requiredCourseCodes.length > 0) {
    const courses = await db.trainingCourse.findMany({
      where: { code: { in: requiredCourseCodes } },
      select: { id: true, code: true, title: true },
    });
    if (courses.length !== requiredCourseCodes.length) {
      throw new Error(
        "One or more prerequisite courses are missing from the catalog. Contact support.",
      );
    }
    const completions = await db.trainingCompletion.findMany({
      where: {
        userId: user.id,
        practiceId: pu.practiceId,
        courseId: { in: courses.map((c) => c.id) },
        passed: true,
        expiresAt: { gt: new Date() },
      },
      distinct: ["userId", "courseId"],
      select: { courseId: true },
    });
    const completedCourseIds = new Set(completions.map((c) => c.courseId));
    const missing = courses.filter((c) => !completedCourseIds.has(c.id));
    if (missing.length > 0) {
      const titles = missing.map((c) => c.title).join(", ");
      throw new Error(
        `Complete required course${missing.length === 1 ? "" : "s"} first: ${titles}`,
      );
    }
  }

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "POLICY_ACKNOWLEDGED",
      payload: {
        practicePolicyId: policy.id,
        policyCode: policy.policyCode,
        acknowledgingUserId: user.id,
        policyVersion: policy.version,
        signatureText: parsed.signatureText,
      },
    },
    async (tx) =>
      projectPolicyAcknowledged(tx, {
        practiceId: pu.practiceId,
        payload: {
          practicePolicyId: policy.id,
          policyCode: policy.policyCode,
          acknowledgingUserId: user.id,
          policyVersion: policy.version,
          signatureText: parsed.signatureText,
        },
      }),
  );

  revalidatePath("/programs/policies");
  revalidatePath(`/programs/policies/${policy.id}`);
  revalidatePath(`/programs/policies/${policy.id}/acknowledgments`);
  revalidatePath("/me/acknowledgments");
}

/**
 * Audit C-2 (HIPAA): gated to ADMIN+. Retiring a policy drops it off
 * the compliance shelf and can flip a framework rule to GAP — STAFF/
 * VIEWER could nuke an active policy and tank the score.
 */
export async function retirePolicyAction(input: z.infer<typeof RetireInput>) {
  const pu = await requireRole("ADMIN");
  const user = pu.dbUser;
  const parsed = RetireInput.parse(input);

  const target = await db.practicePolicy.findUnique({
    where: { id: parsed.practicePolicyId },
  });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Unauthorized: policy not in your practice");
  }
  if (target.retiredAt) return; // idempotent no-op

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "POLICY_RETIRED",
      payload: {
        practicePolicyId: target.id,
        policyCode: target.policyCode,
      },
    },
    async (tx) =>
      projectPolicyRetired(tx, {
        practiceId: pu.practiceId,
        payload: {
          practicePolicyId: target.id,
          policyCode: target.policyCode,
        },
      }),
  );

  revalidatePath("/programs/policies");
  revalidatePath("/modules/hipaa");
}
