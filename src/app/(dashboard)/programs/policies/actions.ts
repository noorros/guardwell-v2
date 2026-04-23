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
