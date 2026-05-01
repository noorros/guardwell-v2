// src/lib/notifications/generators/credentialEscalation.ts

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";
import { type NotificationProposal, DAY_MS } from "./types";
import { ownerAdminUserIds } from "./helpers";

const ESCALATION_THRESHOLD_DAYS = 14;

/**
 * A CREDENTIAL_EXPIRING notification has gone unaddressed for 14+ days →
 * escalate to managers. Same scan-then-cross-check pattern as
 * generateTrainingEscalationNotifications (see comment block above).
 *
 * Source notification entityKey scheme (from generateCredentialNotifications):
 * `credential:{credentialId}:{YYYY-MM-DD}`. Parse the credentialId out
 * and re-confirm the credential is still active (`retiredAt IS NULL`)
 * AND its expiryDate hasn't been pushed past the original date — i.e.
 * the credential wasn't renewed in place. EntityKey is
 * `credential-escalation:{credentialId}` so a renewal (which assigns a
 * new credential id elsewhere) starts a fresh dedup window.
 *
 * Note: this generator only escalates CREDENTIAL_EXPIRING. CMS_ENROLLMENT_EXPIRING
 * and CREDENTIAL_RENEWAL_DUE use different entityKey shapes
 * (`cms-enrollment:{id}:milestone:{N}`, `credential:{id}:milestone:{N}`)
 * and would need separate escalation generators if we wanted parity —
 * filed as a follow-up after launch.
 */
export async function generateCredentialEscalationNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // Owner/admin-only — see comment on generatePolicyReviewDueNotifications.
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_DAYS * DAY_MS);

  const stale = await tx.notification.findMany({
    where: {
      practiceId,
      type: "CREDENTIAL_EXPIRING",
      createdAt: { lt: cutoff },
      readAt: null,
    },
    select: { id: true, entityKey: true },
  });
  if (stale.length === 0) return [];

  // EntityKey scheme from generateCredentialNotifications:
  // `credential:{credentialId}:{YYYY-MM-DD}`. Strip the prefix, drop the
  // trailing date segment.
  const seen = new Map<string, string>(); // credentialId -> original ISO date string
  for (const n of stale) {
    if (!n.entityKey) continue;
    const prefix = "credential:";
    if (!n.entityKey.startsWith(prefix)) continue;
    const body = n.entityKey.slice(prefix.length);
    // Skip credential-renewal-due rows that share the `credential:` prefix
    // but use `credential:{id}:milestone:{N}`. Those are a different
    // notification type and shouldn't surface here, but the type filter
    // above already gates that — extra defense.
    if (body.includes(":milestone:")) continue;
    const lastColon = body.lastIndexOf(":");
    if (lastColon < 0) continue;
    const credentialId = body.slice(0, lastColon);
    const dateStr = body.slice(lastColon + 1);
    if (!credentialId || !dateStr) continue;
    // If multiple stale CREDENTIAL_EXPIRING rows exist for the same
    // credential with different dates, keep the latest (lex compare on
    // YYYY-MM-DD is equivalent to chronological compare).
    const prior = seen.get(credentialId);
    if (!prior || dateStr > prior) seen.set(credentialId, dateStr);
  }
  if (seen.size === 0) return [];

  const credentials = await tx.credential.findMany({
    where: {
      id: { in: Array.from(seen.keys()) },
      practiceId,
      retiredAt: null,
    },
    select: {
      id: true,
      title: true,
      expiryDate: true,
      holderId: true,
      credentialType: { select: { name: true, code: true } },
      holder: {
        select: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  });

  const proposals: NotificationProposal[] = [];
  for (const cred of credentials) {
    if (!cred.expiryDate) continue;
    // Cross-check: credential is unrenewed if its expiryDate hasn't been
    // pushed past the date that fired the original notification. (A
    // renewal-in-place bumps expiryDate forward; a fresh credential gets
    // a new id and won't match `seen` anyway.)
    const originalDateStr = seen.get(cred.id);
    if (!originalDateStr) continue;
    // entityKey is a UTC-stable dedup hash — do NOT replace with formatPracticeDate
    const currentDateStr = cred.expiryDate.toISOString().slice(0, 10);
    if (currentDateStr !== originalDateStr) continue; // renewed in place

    const holderName =
      `${cred.holder?.user?.firstName ?? ""} ${cred.holder?.user?.lastName ?? ""}`.trim() ||
      cred.holder?.user?.email ||
      cred.title ||
      "Unassigned credential";
    const credentialTypeName =
      cred.credentialType?.name ?? cred.title ?? "Credential";
    const expiryStr = formatPracticeDate(cred.expiryDate, practiceTimezone);
    const entityKey = `credential-escalation:${cred.id}`;
    const title = `Credential expiring without action: ${holderName} — ${credentialTypeName}`;
    const body = `${holderName}'s ${credentialTypeName} expiring on ${expiryStr} hasn't been addressed for ${ESCALATION_THRESHOLD_DAYS} days. Renew or follow up.`;

    for (const uid of adminIds) {
      proposals.push({
        userId: uid,
        practiceId,
        type: "CREDENTIAL_ESCALATION" as NotificationType,
        severity: "WARNING" as NotificationSeverity,
        title,
        body,
        href: `/credentials/${cred.id}`,
        entityKey,
      });
    }
  }
  return proposals;
}
