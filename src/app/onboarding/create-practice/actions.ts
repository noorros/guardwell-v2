"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { defaultTimezoneForState } from "@/lib/timezone/stateDefaults";

const Schema = z.object({
  name: z.string().min(1).max(200),
  primaryState: z.string().length(2).regex(/^[A-Z]{2}$/),
});

export async function createPracticeAction(formData: FormData) {
  const user = await requireUser();
  const parsed = Schema.parse({
    name: String(formData.get("name") ?? ""),
    primaryState: String(formData.get("primaryState") ?? "").toUpperCase(),
  });

  const practice = await db.practice.create({
    data: {
      name: parsed.name,
      primaryState: parsed.primaryState,
      timezone: defaultTimezoneForState(parsed.primaryState),
    },
  });

  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "PRACTICE_CREATED",
      payload: {
        practiceName: parsed.name,
        primaryState: parsed.primaryState,
        ownerUserId: user.id,
      },
    },
    async (tx) => {
      await tx.practiceUser.create({
        data: {
          userId: user.id,
          practiceId: practice.id,
          role: "OWNER",
          isPrivacyOfficer: true,
          isComplianceOfficer: true,
        },
      });
    },
  );

  redirect("/dashboard");
}
