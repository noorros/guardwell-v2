// src/app/(dashboard)/audit/regulatory/actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/rbac";
import {
  acknowledgeAlert,
  dismissAlert,
  addAlertActionToAlert,
  toggleSourceActive,
} from "@/lib/regulatory/alertMutations";

// All four actions delegate the actual DB mutation to helpers in
// src/lib/regulatory/ so the gw/no-direct-projection-mutation ESLint
// rule (which gates writes to RegulatoryAlert / AlertAction /
// RegulatorySource / RegulatoryArticle) stays satisfied without
// expanding ALLOWED_PATHS into the dashboard tree.

const acknowledgeSchema = z.object({ alertId: z.string().min(1) });
const dismissSchema = z.object({ alertId: z.string().min(1) });
const addToCapSchema = z.object({
  alertId: z.string().min(1),
  description: z.string().min(1).max(500),
  // YYYY-MM-DD from <input type="date">. Optional + nullable.
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .nullable()
    .optional(),
});
const toggleSourceSchema = z.object({
  sourceId: z.string().min(1),
  isActive: z.boolean(),
});

export type RegulatoryActionResult = { ok: true } | { ok: false; error: string };
export type AddAlertToCapResult =
  | { ok: true; actionId: string }
  | { ok: false; error: string };

export async function acknowledgeAlertAction(
  input: z.infer<typeof acknowledgeSchema>,
): Promise<RegulatoryActionResult> {
  try {
    const pu = await requireRole("ADMIN");
    const { alertId } = acknowledgeSchema.parse(input);
    await acknowledgeAlert(alertId, pu.practiceId, pu.userId);
    revalidatePath(`/audit/regulatory/${alertId}`);
    revalidatePath("/audit/regulatory");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export async function dismissAlertAction(
  input: z.infer<typeof dismissSchema>,
): Promise<RegulatoryActionResult> {
  try {
    const pu = await requireRole("ADMIN");
    const { alertId } = dismissSchema.parse(input);
    await dismissAlert(alertId, pu.practiceId, pu.userId);
    revalidatePath(`/audit/regulatory/${alertId}`);
    revalidatePath("/audit/regulatory");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export async function addAlertToCapAction(
  input: z.infer<typeof addToCapSchema>,
): Promise<AddAlertToCapResult> {
  try {
    const pu = await requireRole("ADMIN");
    const parsed = addToCapSchema.parse(input);
    const dueDate = parsed.dueDate
      ? new Date(`${parsed.dueDate}T12:00:00.000Z`)
      : null;
    const result = await addAlertActionToAlert(
      parsed.alertId,
      pu.practiceId,
      parsed.description,
      { ownerUserId: pu.userId, dueDate },
    );
    revalidatePath(`/audit/regulatory/${parsed.alertId}`);
    return { ok: true, actionId: result.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/**
 * RegulatorySource is a global table — toggling it affects every
 * tenant. ADMIN scope wouldn't be tight enough (any practice's admin
 * could disable a feed for everyone). We require OWNER for now;
 * upgrade to a platform-admin gate once such a role exists.
 */
export async function toggleSourceAction(
  input: z.infer<typeof toggleSourceSchema>,
): Promise<RegulatoryActionResult> {
  try {
    await requireRole("OWNER");
    const { sourceId, isActive } = toggleSourceSchema.parse(input);
    await toggleSourceActive(sourceId, isActive);
    revalidatePath("/audit/regulatory/sources");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
