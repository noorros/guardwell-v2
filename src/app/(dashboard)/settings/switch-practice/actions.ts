// src/app/(dashboard)/settings/switch-practice/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { setSelectedPracticeId } from "@/lib/practice-cookie";

const Schema = z.object({
  practiceId: z.string().min(1),
});

/**
 * Audit #7 (HIPAA B-3): switches the user's active practice by writing
 * the selectedPracticeId cookie. Re-validates that the user has an
 * active membership in the target practice before writing — a tampered
 * cookie can still only land on a practice the user is already in (the
 * `getPracticeUser` lookup applies the same filter).
 *
 * Takes FormData so the dropdown can submit each option as a `<form>`
 * with a hidden input, matching the sign-out pattern in UserMenu.
 */
export async function switchPracticeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = Schema.parse({
    practiceId: String(formData.get("practiceId") ?? ""),
  });

  const membership = await db.practiceUser.findFirst({
    where: {
      userId: user.id,
      practiceId: parsed.practiceId,
      removedAt: null,
    },
    select: { id: true },
  });
  if (!membership) {
    throw new Error("You are not a member of that practice.");
  }

  await setSelectedPracticeId(parsed.practiceId);
  // Refresh every cached server-render under /dashboard so the new
  // practice's data renders cleanly. revalidatePath("/dashboard",
  // "layout") catches the layout and every nested route.
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}
