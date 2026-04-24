// src/app/(dashboard)/programs/policies/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectPolicyAdopted,
  projectPolicyRetired,
  projectPolicyReviewed,
} from "@/lib/events/projections/policyAdopted";
import { ALL_POLICY_CODES } from "@/lib/compliance/policies";
import { db } from "@/lib/db";

const AdoptInput = z.object({
  policyCode: z.enum(ALL_POLICY_CODES),
});

const RetireInput = z.object({
  practicePolicyId: z.string().min(1),
});

export async function adoptPolicyAction(input: z.infer<typeof AdoptInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
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

export async function reviewPolicyAction(input: z.infer<typeof ReviewInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
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

export async function adoptPolicyFromTemplateAction(
  input: z.infer<typeof AdoptFromTemplateInput>,
) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
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

export async function retirePolicyAction(input: z.infer<typeof RetireInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
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
