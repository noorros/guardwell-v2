// src/app/(dashboard)/programs/cybersecurity/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPhishingDrillLogged } from "@/lib/events/projections/phishingDrill";
import { projectMfaEnrollmentRecorded } from "@/lib/events/projections/mfaEnrollment";
import { projectBackupVerificationLogged } from "@/lib/events/projections/backupVerification";

// ──────────────────────────────────────────────────────────────────────
// Phishing drill
// ──────────────────────────────────────────────────────────────────────

const PhishingInput = z.object({
  conductedAtIso: z.string().min(1),
  vendor: z.string().max(200).optional(),
  totalRecipients: z.number().int().min(1),
  clickedCount: z.number().int().min(0),
  reportedCount: z.number().int().min(0),
  attachmentUrl: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export async function logPhishingDrillAction(
  input: z.infer<typeof PhishingInput>,
) {
  const user = await requireUser();
  // Audit OSHA I-10: phishing drill results feed the HIPAA Security
  // Awareness training requirement (§164.308(a)(5)(ii)(B)) and the
  // SRA. STAFF/VIEWER must not be able to log fictitious drill stats
  // that auto-derive HIPAA_SECURITY_AWARENESS to COMPLIANT.
  const pu = await requireRole("ADMIN");
  const parsed = PhishingInput.parse(input);
  if (parsed.clickedCount > parsed.totalRecipients) {
    throw new Error("Clicked count cannot exceed total recipients");
  }
  if (parsed.reportedCount > parsed.totalRecipients) {
    throw new Error("Reported count cannot exceed total recipients");
  }

  const phishingDrillId = randomUUID();
  const conductedAt = new Date(parsed.conductedAtIso);
  if (isNaN(conductedAt.getTime())) {
    throw new Error("Invalid conducted-at date");
  }

  const payload = {
    phishingDrillId,
    conductedAt: conductedAt.toISOString(),
    vendor: parsed.vendor ?? null,
    totalRecipients: parsed.totalRecipients,
    clickedCount: parsed.clickedCount,
    reportedCount: parsed.reportedCount,
    attachmentUrl: parsed.attachmentUrl ?? null,
    loggedByUserId: user.id,
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "PHISHING_DRILL_LOGGED",
      payload,
    },
    async (tx) =>
      projectPhishingDrillLogged(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/cybersecurity");
  revalidatePath("/modules/hipaa");
}

// ──────────────────────────────────────────────────────────────────────
// MFA enrollment attestation (per-user)
// ──────────────────────────────────────────────────────────────────────

const MfaInput = z.object({
  practiceUserId: z.string().min(1),
  enrolled: z.boolean(),
  notes: z.string().max(1000).optional(),
});

export async function recordMfaEnrollmentAction(
  input: z.infer<typeof MfaInput>,
) {
  const user = await requireUser();
  // Audit OSHA I-10: MFA enrollment feeds the HIPAA Access Control
  // §164.312(d) requirement. STAFF must not flip their own (or each
  // other's) enrollment bit and short-circuit the audit-required
  // attestation that the officer reviewed enrollment.
  const pu = await requireRole("ADMIN");
  const parsed = MfaInput.parse(input);

  // Cross-practice guard: the target PracticeUser must belong to the
  // current practice. Otherwise an officer at one practice could flip
  // bits on a user at another.
  const target = await db.practiceUser.findUnique({
    where: { id: parsed.practiceUserId },
    select: { practiceId: true },
  });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Practice user not found");
  }

  const payload = {
    practiceUserId: parsed.practiceUserId,
    enrolled: parsed.enrolled,
    recordedByUserId: user.id,
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "MFA_ENROLLMENT_RECORDED",
      payload,
    },
    async (tx) =>
      projectMfaEnrollmentRecorded(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/cybersecurity");
  revalidatePath("/modules/hipaa");
}

// ──────────────────────────────────────────────────────────────────────
// Backup verification (restore test)
// ──────────────────────────────────────────────────────────────────────

const BackupInput = z.object({
  verifiedAtIso: z.string().min(1),
  scope: z.string().min(1).max(200),
  success: z.boolean(),
  restoreTimeMinutes: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

export async function logBackupVerificationAction(
  input: z.infer<typeof BackupInput>,
) {
  const user = await requireUser();
  // Audit OSHA I-10: backup verification logs feed §164.308(a)(7)(ii)(D)
  // (data backup contingency plan testing). A STAFF-logged "successful"
  // restore would auto-derive a HIPAA Contingency-Plan requirement to
  // COMPLIANT without anyone with sign-off authority involved.
  const pu = await requireRole("ADMIN");
  const parsed = BackupInput.parse(input);

  const backupVerificationId = randomUUID();
  const verifiedAt = new Date(parsed.verifiedAtIso);
  if (isNaN(verifiedAt.getTime())) {
    throw new Error("Invalid verified-at date");
  }

  const payload = {
    backupVerificationId,
    verifiedAt: verifiedAt.toISOString(),
    scope: parsed.scope,
    success: parsed.success,
    restoreTimeMinutes: parsed.restoreTimeMinutes ?? null,
    loggedByUserId: user.id,
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "BACKUP_VERIFICATION_LOGGED",
      payload,
    },
    async (tx) =>
      projectBackupVerificationLogged(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/cybersecurity");
  revalidatePath("/modules/hipaa");
}
