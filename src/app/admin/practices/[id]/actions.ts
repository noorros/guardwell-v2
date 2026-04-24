// src/app/admin/practices/[id]/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

const Input = z.object({
  practiceId: z.string().min(1),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]),
  trialEndsAtIso: z.string().optional(),
});

export async function overrideSubscriptionStatusAction(
  input: z.infer<typeof Input>,
) {
  await requirePlatformAdmin();
  const parsed = Input.parse(input);
  await db.practice.update({
    where: { id: parsed.practiceId },
    data: {
      subscriptionStatus: parsed.status,
      ...(parsed.trialEndsAtIso
        ? { trialEndsAt: new Date(parsed.trialEndsAtIso) }
        : {}),
    },
  });
  revalidatePath(`/admin/practices/${parsed.practiceId}`);
  revalidatePath("/admin/practices");
  revalidatePath("/admin");
}

const ExtendInput = z.object({
  practiceId: z.string().min(1),
  days: z.number().int().min(1).max(365),
});

export async function extendTrialAction(input: z.infer<typeof ExtendInput>) {
  await requirePlatformAdmin();
  const parsed = ExtendInput.parse(input);
  const practice = await db.practice.findUniqueOrThrow({
    where: { id: parsed.practiceId },
    select: { trialEndsAt: true },
  });
  const base = practice.trialEndsAt ?? new Date();
  const nextTrialEndsAt = new Date(
    base.getTime() + parsed.days * 24 * 60 * 60 * 1000,
  );
  await db.practice.update({
    where: { id: parsed.practiceId },
    data: { trialEndsAt: nextTrialEndsAt, subscriptionStatus: "TRIALING" },
  });
  revalidatePath(`/admin/practices/${parsed.practiceId}`);
  revalidatePath("/admin/practices");
  revalidatePath("/admin");
}
