// src/app/(dashboard)/settings/practice/actions.ts
//
// Server action for /settings/practice — edits the full Practice profile
// (Identity / Location / Practice). Auth resolution happens in the "use
// server" wrapper; the pure helper handleSavePracticeProfile is what
// the integration tests exercise (matches the credential-ceu-action /
// concierge-actions split documented in tests/setup.ts).
//
// Audit trail: emits PRACTICE_PROFILE_UPDATED v2 with { changedFields }
// only — the projection is a no-op because settings doesn't touch
// PracticeFramework toggles. v1 of the same event (richer payload) is
// reserved for the onboarding compliance-profile flow.

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { isValidNpi } from "@/lib/npi";
import { isValidStateCode } from "@/lib/states";
import { deriveSpecialtyCategory } from "@/lib/specialties";
import { appendEventAndApply } from "@/lib/events";
import type { PracticeProfileInput } from "@/components/gw/PracticeProfileForm/types";

const InputSchema = z.object({
  name: z.string().min(1).max(200),
  npiNumber: z.string().nullable(),
  entityType: z.enum(["COVERED_ENTITY", "BUSINESS_ASSOCIATE"]),
  primaryState: z.string().length(2),
  operatingStates: z.array(z.string().length(2)),
  addressStreet: z.string().nullable(),
  addressSuite: z.string().nullable(),
  addressCity: z.string().nullable(),
  addressZip: z
    .string()
    .regex(/^\d{5}$/)
    .nullable(),
  specialty: z.string().nullable(),
  providerCount: z.enum(["SOLO", "SMALL_2_5", "MEDIUM_6_15", "LARGE_16_PLUS"]),
  ehrSystem: z.string().nullable(),
  staffHeadcount: z.number().int().min(0).nullable(),
  phone: z.string().nullable(),
});

export type SavePracticeProfileResult =
  | { ok: true }
  | { ok: false; error: string };

const TRACKED_FIELDS = [
  "name",
  "npiNumber",
  "entityType",
  "primaryState",
  "operatingStates",
  "addressStreet",
  "addressSuite",
  "addressCity",
  "addressZip",
  "specialty",
  "providerCount",
  "ehrSystem",
  "staffHeadcount",
  "phone",
] as const satisfies readonly (keyof PracticeProfileInput)[];

/**
 * Pure helper invoked from both the server-action wrapper and the
 * integration test suite. Does NOT call getPracticeUser — caller passes
 * the resolved {practiceId, actorUserId} ctx. Validates the payload,
 * diffs against the current Practice row, and writes both Practice +
 * PracticeComplianceProfile.specialtyCategory inside the
 * appendEventAndApply transaction.
 */
export async function handleSavePracticeProfile(
  ctx: { practiceId: string; actorUserId: string },
  input: PracticeProfileInput,
): Promise<SavePracticeProfileResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  const data = parsed.data;

  if (data.npiNumber && !isValidNpi(data.npiNumber)) {
    return { ok: false, error: "Invalid NPI checksum." };
  }
  if (!isValidStateCode(data.primaryState)) {
    return { ok: false, error: "Invalid primary state." };
  }
  for (const s of data.operatingStates) {
    if (!isValidStateCode(s)) {
      return { ok: false, error: `Invalid state: ${s}` };
    }
  }

  const before = await db.practice.findUniqueOrThrow({
    where: { id: ctx.practiceId },
  });

  const changed: string[] = [];
  for (const k of TRACKED_FIELDS) {
    const beforeVal = JSON.stringify(
      (before as Record<string, unknown>)[k] ?? null,
    );
    const afterVal = JSON.stringify(data[k] ?? null);
    if (beforeVal !== afterVal) changed.push(k);
  }

  const bucket = deriveSpecialtyCategory(data.specialty);

  await appendEventAndApply(
    {
      practiceId: ctx.practiceId,
      actorUserId: ctx.actorUserId,
      type: "PRACTICE_PROFILE_UPDATED",
      schemaVersion: 2,
      payload: { changedFields: changed },
    },
    async (tx) => {
      await tx.practice.update({
        where: { id: ctx.practiceId },
        data: {
          name: data.name,
          npiNumber: data.npiNumber,
          entityType: data.entityType,
          primaryState: data.primaryState,
          operatingStates: data.operatingStates,
          addressStreet: data.addressStreet,
          addressSuite: data.addressSuite,
          addressCity: data.addressCity,
          addressZip: data.addressZip,
          specialty: data.specialty,
          providerCount: data.providerCount,
          ehrSystem: data.ehrSystem,
          staffHeadcount: data.staffHeadcount,
          phone: data.phone,
        },
      });
      // Keep the legacy 6-bucket category in sync. The toggles + framework
      // applicability are owned by saveComplianceProfileAction (onboarding),
      // not this surface, so we only touch the derived bucket here.
      await tx.practiceComplianceProfile.upsert({
        where: { practiceId: ctx.practiceId },
        create: {
          practiceId: ctx.practiceId,
          specialtyCategory: bucket,
        },
        update: {
          specialtyCategory: bucket,
        },
      });
    },
  );

  return { ok: true };
}

export async function savePracticeProfileAction(
  input: PracticeProfileInput,
): Promise<SavePracticeProfileResult> {
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "Not authenticated." };
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    return {
      ok: false,
      error: "Only owners and admins can update the practice profile.",
    };
  }
  const result = await handleSavePracticeProfile(
    { practiceId: pu.practiceId, actorUserId: pu.dbUser.id },
    input,
  );
  if (result.ok) {
    revalidatePath("/settings/practice");
    revalidatePath("/dashboard");
  }
  return result;
}
