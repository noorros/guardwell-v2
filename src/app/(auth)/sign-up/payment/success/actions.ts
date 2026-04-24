// src/app/(auth)/sign-up/payment/success/actions.ts
"use server";

import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";

export async function getMySubscriptionStatusAction(): Promise<string> {
  const pu = await getPracticeUser();
  if (!pu) return "INCOMPLETE";
  const p = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { subscriptionStatus: true },
  });
  return p.subscriptionStatus;
}
