// src/lib/notifications/generators.ts
//
// Pure generators — each one takes a Prisma transaction client and a
// practice, and returns an array of "proposed notifications" to create.
// Dedup via (userId, type, entityKey) unique constraint; running the
// digest twice in the same period is a no-op for notifications the user
// has already received.
//
// Generators deliberately don't write to the DB. The digest runner
// collects all proposals, filters against existing rows, and bulk-
// inserts the new ones.

import type { Prisma, NotificationType, NotificationSeverity } from "@prisma/client";

export interface NotificationProposal {
  userId: string;
  practiceId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string | null;
  entityKey: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SRA_OBLIGATION_DAYS = 365;
const SRA_WARNING_DAYS = 60; // Warn when SRA is within 60 days of expiry

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.round((date.getTime() - Date.now()) / DAY_MS);
}

/**
 * HIPAA_SRA is due / overdue. Warn 60 days before the 365-day wall, hit
 * CRITICAL once past.
 */
export async function generateSraNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
): Promise<NotificationProposal[]> {
  const latest = await tx.practiceSraAssessment.findFirst({
    where: { practiceId, isDraft: false, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true, id: true },
  });
  if (!latest?.completedAt) {
    // No SRA ever — one-time nudge per user.
    return userIds.map((userId) => ({
      userId,
      practiceId,
      type: "SRA_DUE" as NotificationType,
      severity: "WARNING" as NotificationSeverity,
      title: "Complete your first Security Risk Assessment",
      body: "HIPAA §164.308(a)(1)(ii)(A) requires a documented Security Risk Assessment. Complete one to satisfy HIPAA_SRA.",
      href: "/programs/risk/new",
      entityKey: "none",
    }));
  }
  const dueDate = new Date(latest.completedAt.getTime() + SRA_OBLIGATION_DAYS * DAY_MS);
  const daysLeft = daysUntil(dueDate);
  if (daysLeft === null) return [];
  if (daysLeft > SRA_WARNING_DAYS) return [];

  const severity: NotificationSeverity = daysLeft <= 0 ? "CRITICAL" : "WARNING";
  const title =
    daysLeft <= 0
      ? "SRA is overdue — HIPAA_SRA flipped GAP"
      : `SRA expires in ${daysLeft} days`;
  const body =
    daysLeft <= 0
      ? `Your most recent Security Risk Assessment was completed ${latest.completedAt.toISOString().slice(0, 10)} and is now past the 365-day obligation window. Run a fresh SRA to restore HIPAA_SRA compliance.`
      : `Your most recent SRA was completed ${latest.completedAt.toISOString().slice(0, 10)}. Plan the next one — HIPAA_SRA flips GAP on ${dueDate.toISOString().slice(0, 10)}.`;

  // entityKey includes the source SRA id so a replacement SRA resets the
  // dedup and users get a fresh notification cycle for the new window.
  const entityKey = `sra:${latest.id}`;

  return userIds.map((userId) => ({
    userId,
    practiceId,
    type: "SRA_DUE" as NotificationType,
    severity,
    title,
    body,
    href: "/programs/risk",
    entityKey,
  }));
}

/**
 * Credentials expiring within 60 days. One notification per credential
 * per holder. Entity key includes the credential id so a renewed
 * credential (new id) produces a fresh notification cycle.
 */
export async function generateCredentialNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
): Promise<NotificationProposal[]> {
  const horizon = new Date(Date.now() + 60 * DAY_MS);
  const credentials = await tx.credential.findMany({
    where: {
      practiceId,
      retiredAt: null,
      expiryDate: { lte: horizon, gt: new Date(Date.now() - 30 * DAY_MS) },
    },
    select: {
      id: true,
      title: true,
      expiryDate: true,
      licenseNumber: true,
    },
  });
  const proposals: NotificationProposal[] = [];
  for (const c of credentials) {
    if (!c.expiryDate) continue;
    const daysLeft = daysUntil(c.expiryDate);
    if (daysLeft === null) continue;
    const severity: NotificationSeverity =
      daysLeft <= 0 ? "CRITICAL" : daysLeft <= 14 ? "WARNING" : "INFO";
    const title =
      daysLeft <= 0
        ? `${c.title} expired`
        : `${c.title} expires in ${daysLeft} days`;
    const body = `${c.title}${c.licenseNumber ? ` (${c.licenseNumber})` : ""} expires ${c.expiryDate.toISOString().slice(0, 10)}. Update /programs/credentials before it lapses.`;
    const entityKey = `credential:${c.id}:${c.expiryDate.toISOString().slice(0, 10)}`;
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "CREDENTIAL_EXPIRING",
        severity,
        title,
        body,
        href: "/programs/credentials",
        entityKey,
      });
    }
  }
  return proposals;
}

/**
 * Vendor BAAs expiring within 60 days. Same shape as credential warnings.
 */
export async function generateVendorBaaNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
): Promise<NotificationProposal[]> {
  const horizon = new Date(Date.now() + 60 * DAY_MS);
  const vendors = await tx.vendor.findMany({
    where: {
      practiceId,
      retiredAt: null,
      processesPhi: true,
      baaExpiresAt: { lte: horizon },
    },
    select: { id: true, name: true, baaExpiresAt: true },
  });
  const proposals: NotificationProposal[] = [];
  for (const v of vendors) {
    if (!v.baaExpiresAt) continue;
    const daysLeft = daysUntil(v.baaExpiresAt);
    if (daysLeft === null) continue;
    const severity: NotificationSeverity =
      daysLeft <= 0 ? "CRITICAL" : daysLeft <= 14 ? "WARNING" : "INFO";
    const title =
      daysLeft <= 0
        ? `BAA with ${v.name} has expired`
        : `BAA with ${v.name} expires in ${daysLeft} days`;
    const body = `The Business Associate Agreement with ${v.name} expires ${v.baaExpiresAt.toISOString().slice(0, 10)}. Renew before expiry to keep HIPAA_BAAS compliant.`;
    const entityKey = `vendor-baa:${v.id}:${v.baaExpiresAt.toISOString().slice(0, 10)}`;
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "VENDOR_BAA_EXPIRING",
        severity,
        title,
        body,
        href: "/programs/vendors",
        entityKey,
      });
    }
  }
  return proposals;
}

/**
 * Incidents that are open or under investigation and haven't had a
 * breach determination yet. Nudges the team to run the four-factor
 * analysis. One notification per incident per user.
 */
export async function generateIncidentNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
): Promise<NotificationProposal[]> {
  const openIncidents = await tx.incident.findMany({
    where: {
      practiceId,
      status: { in: ["OPEN", "UNDER_INVESTIGATION"] },
      isBreach: null,
    },
    select: { id: true, title: true, discoveredAt: true },
  });
  const unresolvedBreaches = await tx.incident.findMany({
    where: {
      practiceId,
      isBreach: true,
      resolvedAt: null,
    },
    select: {
      id: true,
      title: true,
      discoveredAt: true,
      affectedCount: true,
    },
  });

  const proposals: NotificationProposal[] = [];
  for (const inc of openIncidents) {
    const daysOpen = Math.max(
      0,
      Math.floor((Date.now() - inc.discoveredAt.getTime()) / DAY_MS),
    );
    const entityKey = `incident-open:${inc.id}`;
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "INCIDENT_OPEN",
        severity: daysOpen > 7 ? "WARNING" : "INFO",
        title: `Incident awaiting breach determination (${daysOpen}d open)`,
        body: `"${inc.title}" is still open. Run the HIPAA §164.402 four-factor analysis to classify.`,
        href: `/programs/incidents/${inc.id}`,
        entityKey,
      });
    }
  }
  for (const inc of unresolvedBreaches) {
    const daysOpen = Math.max(
      0,
      Math.floor((Date.now() - inc.discoveredAt.getTime()) / DAY_MS),
    );
    const deadlineDaysLeft = Math.max(0, 60 - daysOpen);
    const entityKey = `incident-breach:${inc.id}`;
    const isMajor = (inc.affectedCount ?? 0) >= 500;
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "INCIDENT_BREACH_UNRESOLVED",
        severity: deadlineDaysLeft <= 7 ? "CRITICAL" : "WARNING",
        title: isMajor
          ? `Major breach unresolved — HHS notice in ${deadlineDaysLeft} days`
          : `Breach unresolved — HHS notice in ${deadlineDaysLeft} days`,
        body: `"${inc.title}" was determined a breach on ${inc.discoveredAt.toISOString().slice(0, 10)}. HHS OCR notification deadline is ${deadlineDaysLeft} days away. ${isMajor ? "Major-breach media notice is also required." : ""}`.trim(),
        href: `/programs/incidents/${inc.id}`,
        entityKey,
      });
    }
  }
  return proposals;
}

// ---------------------------------------------------------------------------
// Allergy / USP §21 generators
// ---------------------------------------------------------------------------

const DRILL_DUE_WINDOW_DAYS = 30;
const FRIDGE_OVERDUE_DAYS = 30;
const KIT_EXPIRY_WINDOW_DAYS = 60;

/**
 * Three notifications for the allergy program:
 *   - Anaphylaxis drill due (next drill within N days OR overdue)
 *   - Refrigerator temp log overdue (>30 days since last check)
 *   - Emergency kit expiring (epi within 60 days)
 *
 * No-ops gracefully when the ALLERGY framework is not enabled for the
 * practice.
 */
export async function generateAllergyNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
): Promise<NotificationProposal[]> {
  const enabled = await tx.practiceFramework.findFirst({
    where: {
      practiceId,
      enabled: true,
      framework: { code: "ALLERGY" },
    },
  });
  if (!enabled) return [];

  const proposals: NotificationProposal[] = [];

  // ── Drill due ────────────────────────────────────────────────────────────
  const lastDrill = await tx.allergyDrill.findFirst({
    where: { practiceId },
    orderBy: { conductedAt: "desc" },
    select: { id: true, nextDrillDue: true },
  });
  if (lastDrill?.nextDrillDue) {
    const daysLeft = daysUntil(lastDrill.nextDrillDue);
    if (daysLeft !== null && daysLeft <= DRILL_DUE_WINDOW_DAYS) {
      const severity: NotificationSeverity = daysLeft < 0 ? "CRITICAL" : "WARNING";
      const title =
        daysLeft < 0
          ? "Anaphylaxis drill overdue"
          : `Anaphylaxis drill due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
      for (const userId of userIds) {
        proposals.push({
          userId,
          practiceId,
          type: "ALLERGY_DRILL_DUE",
          severity,
          title,
          body: "Schedule the next anaphylaxis drill at /programs/allergy.",
          href: "/programs/allergy",
          entityKey: `allergy-drill-${lastDrill.id}`,
        });
      }
    }
  } else if (!lastDrill) {
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "ALLERGY_DRILL_DUE",
        severity: "WARNING",
        title: "Anaphylaxis drill not yet on file",
        body: "Run your first anaphylaxis drill to satisfy USP §21 §21.6.",
        href: "/programs/allergy",
        entityKey: "allergy-drill-initial",
      });
    }
  }

  // ── Refrigerator overdue ─────────────────────────────────────────────────
  const lastFridge = await tx.allergyEquipmentCheck.findFirst({
    where: { practiceId, checkType: "REFRIGERATOR_TEMP" },
    orderBy: { checkedAt: "desc" },
    select: { id: true, checkedAt: true },
  });
  if (
    !lastFridge ||
    Date.now() - lastFridge.checkedAt.getTime() > FRIDGE_OVERDUE_DAYS * DAY_MS
  ) {
    for (const userId of userIds) {
      proposals.push({
        userId,
        practiceId,
        type: "ALLERGY_FRIDGE_OVERDUE",
        severity: "CRITICAL",
        title: "Refrigerator temperature log overdue",
        body: "Log a temperature reading at /programs/allergy.",
        href: "/programs/allergy",
        entityKey: lastFridge ? `fridge-${lastFridge.id}` : "fridge-initial",
      });
    }
  }

  // ── Kit expiring ─────────────────────────────────────────────────────────
  const lastKit = await tx.allergyEquipmentCheck.findFirst({
    where: { practiceId, checkType: "EMERGENCY_KIT" },
    orderBy: { checkedAt: "desc" },
    select: { id: true, epiExpiryDate: true },
  });
  if (lastKit?.epiExpiryDate) {
    const daysLeft = daysUntil(lastKit.epiExpiryDate);
    if (daysLeft !== null && daysLeft <= KIT_EXPIRY_WINDOW_DAYS) {
      const severity: NotificationSeverity = daysLeft < 0 ? "CRITICAL" : "WARNING";
      const title =
        daysLeft < 0
          ? "Epinephrine in the emergency kit has expired"
          : `Epinephrine expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
      for (const userId of userIds) {
        proposals.push({
          userId,
          practiceId,
          type: "ALLERGY_KIT_EXPIRING",
          severity,
          title,
          body: "Replace the auto-injector at /programs/allergy.",
          href: "/programs/allergy",
          entityKey: `allergy-kit-${lastKit.id}`,
        });
      }
    }
  }

  return proposals;
}

/**
 * Aggregate all generators for a practice. Order doesn't affect
 * uniqueness (dedup runs on insert), but sorting keeps the digest email
 * body in a predictable order.
 */
export async function generateAllNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
): Promise<NotificationProposal[]> {
  if (userIds.length === 0) return [];
  const [sra, creds, vendors, incidents, allergy] = await Promise.all([
    generateSraNotifications(tx, practiceId, userIds),
    generateCredentialNotifications(tx, practiceId, userIds),
    generateVendorBaaNotifications(tx, practiceId, userIds),
    generateIncidentNotifications(tx, practiceId, userIds),
    generateAllergyNotifications(tx, practiceId, userIds),
  ]);
  return [...sra, ...creds, ...vendors, ...incidents, ...allergy];
}
