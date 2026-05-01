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
import { formatPracticeDate } from "@/lib/audit/format";
import { EXPIRING_SOON_DAYS } from "@/lib/credentials/status";
import { getEffectiveLeadTimes } from "./leadTimes";

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
  // Math.floor (not Math.round) so "30.7 days until expiry" → 30, not 31.
  // Combined with "days <= milestone" matching in the renewal generators,
  // this makes milestone firing deterministic regardless of when the cron
  // runs within the boundary day. Without floor, a delayed/retried cron
  // straddling a milestone day could fire twice (saved by entityKey
  // dedup) OR skip the milestone entirely. Audit #21 Credentials IM-7.
  return Math.floor((date.getTime() - Date.now()) / DAY_MS);
}

/**
 * Returns the ISO 8601 week number ("01"-"53") for a date as a zero-padded
 * 2-char string. Used by the absence-based generators (phishing, backup,
 * destruction) for year-week dedup entityKeys so a stale practice gets
 * exactly one nudge per week, not one per digest run.
 *
 * Algorithm: Thursday of the week determines the week's year (per ISO 8601).
 */
function getIsoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return weekNum.toString().padStart(2, "0");
}

/**
 * HIPAA_SRA is due / overdue. Warn 60 days before the 365-day wall, hit
 * CRITICAL once past.
 */
export async function generateSraNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
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
      ? `Your most recent Security Risk Assessment was completed ${formatPracticeDate(latest.completedAt, practiceTimezone)} and is now past the 365-day obligation window. Run a fresh SRA to restore HIPAA_SRA compliance.`
      : `Your most recent SRA was completed ${formatPracticeDate(latest.completedAt, practiceTimezone)}. Plan the next one — HIPAA_SRA flips GAP on ${formatPracticeDate(dueDate, practiceTimezone)}.`;

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
 * Credentials expiring within EXPIRING_SOON_DAYS. One notification per
 * credential per holder. Entity key includes the credential id so a
 * renewed credential (new id) produces a fresh notification cycle.
 *
 * Audit #16: window now sourced from src/lib/credentials/status.ts so
 * the dashboard badge, the register PDF, and these notifications all
 * agree on the 90-day threshold (the page+Concierge had been showing
 * EXPIRING_SOON 30 days before the email even fired).
 */
export async function generateCredentialNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const horizon = new Date(Date.now() + EXPIRING_SOON_DAYS * DAY_MS);
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
    const body = `${c.title}${c.licenseNumber ? ` (${c.licenseNumber})` : ""} expires ${formatPracticeDate(c.expiryDate, practiceTimezone)}. Update /programs/credentials before it lapses.`;
    // entityKey is a UTC-stable dedup hash — do NOT replace with formatPracticeDate
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
 * Per-credential renewal reminders — fires CREDENTIAL_RENEWAL_DUE for
 * each milestone day (default 90/60/30/7) before expiry. Reads the
 * per-credential CredentialReminderConfig (or uses defaults if no row
 * exists). Skips credentials that are retired or have no expiry date.
 *
 * Each milestone fires exactly once per credential because the entityKey
 * embeds the milestone day; the (userId, type, entityKey) unique
 * constraint dedups across digest runs.
 */
export async function generateCredentialRenewalNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const credentials = await tx.credential.findMany({
    where: {
      practiceId,
      retiredAt: null,
      expiryDate: { not: null },
    },
    select: {
      id: true,
      title: true,
      expiryDate: true,
      holderId: true,
      reminderConfig: {
        select: { enabled: true, milestoneDays: true },
      },
    },
  });

  const proposals: NotificationProposal[] = [];
  // Per-credential reminderConfig still wins when set; per-practice
  // reminderSettings is the fallback above the global default.
  const practiceMilestones = getEffectiveLeadTimes(
    reminderSettings,
    "credentials",
  );

  for (const cred of credentials) {
    if (!cred.expiryDate) continue;
    const config = cred.reminderConfig;
    // Default to enabled when no config exists; explicit disable opts out.
    if (config?.enabled === false) continue;
    const milestones = config?.milestoneDays?.length
      ? config.milestoneDays
      : practiceMilestones;

    const days = daysUntil(cred.expiryDate);
    if (days === null) continue;
    if (days < 0) continue; // Already expired — CREDENTIAL_EXPIRING handles past-expiry.

    // Audit #21 Credentials IM-7: fire every milestone we're inside of
    // (days <= m), not just the one whose boundary we crossed in the last
    // 24h. Idempotent by design — the (userId, type, entityKey) unique
    // constraint dedups across digest runs, where entityKey embeds the
    // milestone day. A delayed/retried cron at any time of day still
    // produces exactly one notification per (credential, milestone).
    const matchedMilestones = milestones.filter((m) => days <= m);
    if (matchedMilestones.length === 0) continue;

    for (const matchedMilestone of matchedMilestones) {
      const severity: NotificationSeverity =
        matchedMilestone <= 7
          ? "CRITICAL"
          : matchedMilestone <= 30
            ? "WARNING"
            : "INFO";
      const entityKey = `credential:${cred.id}:milestone:${matchedMilestone}`;
      const title = `${cred.title} — renewal in ${days} day${days === 1 ? "" : "s"}`;
      const body = `This credential expires ${formatPracticeDate(cred.expiryDate, practiceTimezone)}. Plan the renewal now to avoid a compliance gap.`;

      for (const uid of userIds) {
        proposals.push({
          userId: uid,
          practiceId,
          type: "CREDENTIAL_RENEWAL_DUE" as NotificationType,
          severity,
          title,
          body,
          href: `/programs/credentials/${cred.id}`,
          entityKey,
        });
      }
    }
  }
  return proposals;
}

/**
 * Phase 7 PR 3 — BAA generator split.
 *
 * The original generateVendorBaaNotifications was replaced with three
 * lifecycle-stage generators:
 *   - generateBaaSignaturePendingNotifications: BAA sent, awaiting vendor sig
 *   - generateBaaExpiringNotifications:        BAA approaching expiry (lead-time aware)
 *   - generateBaaExecutedNotifications:        BAA freshly executed (info)
 *
 * Recipients shifted from "all userIds" (old behavior) to OWNER + ADMIN
 * only — STAFF/VIEWER won't see BAA notifications, which is correct
 * since BAAs are admin work.
 */

/**
 * Fires when a BAA has been sent to a vendor but not yet executed
 * (status === SENT or ACKNOWLEDGED) and the request is still active
 * (no rejectedAt).
 *
 * This notification fires ONCE per BaaRequest (entityKey is keyed only on
 * request id). The user gets one nudge when the digest first sees the
 * pending BAA; subsequent digests dedup. If the BAA stays pending
 * indefinitely, the user does NOT get repeated reminders — the dashboard
 * signal (via the vendor list) is the persistent visibility.
 *
 * Severity is constant WARNING. An earlier draft escalated INFO → WARNING
 * after 7 days waiting, but the entityKey lacked a tier component, so
 * dedup would catch the INFO row and the WARNING escalation never reached
 * the user. Single tier avoids that footgun.
 */
export async function generateBaaSignaturePendingNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets
  // OWNER + ADMIN directly via PracticeUser query. Param kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency with the rest of the generators.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const requests = await tx.baaRequest.findMany({
    where: {
      practiceId,
      status: { in: ["SENT", "ACKNOWLEDGED"] },
      rejectedAt: null,
    },
    select: {
      id: true,
      vendorId: true,
      vendor: { select: { name: true } },
    },
  });
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];

  const proposals: NotificationProposal[] = [];
  for (const r of requests) {
    const title = `BAA awaiting vendor signature: ${r.vendor.name}`;
    const body = `${r.vendor.name} hasn't yet signed the BAA. They should receive a token link via email.`;
    const severity: NotificationSeverity = "WARNING";
    for (const userId of adminUserIds) {
      proposals.push({
        userId,
        practiceId,
        type: "BAA_SIGNATURE_PENDING",
        severity,
        title,
        body,
        href: "/programs/vendors",
        entityKey: `baa-signature-pending:${r.id}`,
      });
    }
  }
  return proposals;
}

/**
 * BAAs approaching expiry. Uses getEffectiveLeadTimes(reminderSettings,
 * "baa") for milestones (default [60, 30, 7]). Fires every crossed
 * milestone (matches generateCredentialRenewalNotifications semantic):
 * a vendor expiring in 5 days fires :7, :30, AND :60 — each a distinct
 * notification keyed by milestone, so dedup catches re-fires across
 * cron runs but every milestone gets a fresh nudge.
 *
 * Sources expiry from Vendor.baaExpiresAt (the canonical "BAA expires"
 * field on the vendor), not BaaRequest.expiresAt.
 */
export async function generateBaaExpiringNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets
  // OWNER + ADMIN directly via PracticeUser query. Param kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const milestones = getEffectiveLeadTimes(reminderSettings, "baa");
  const horizonDays = milestones[0] ?? 60;
  const horizon = new Date(Date.now() + horizonDays * DAY_MS);
  const vendors = await tx.vendor.findMany({
    where: {
      practiceId,
      retiredAt: null,
      processesPhi: true,
      baaExpiresAt: { lte: horizon },
    },
    select: { id: true, name: true, baaExpiresAt: true },
  });
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];

  const proposals: NotificationProposal[] = [];
  for (const v of vendors) {
    if (!v.baaExpiresAt) continue;
    const days = daysUntil(v.baaExpiresAt);
    if (days === null) continue;
    // Match generateCredentialRenewalNotifications: fire every milestone
    // we're inside of (days <= m), one notification per (vendor, milestone)
    // with a distinct entityKey. The (userId, type, entityKey) unique
    // constraint dedups across digest runs.
    const matchedMilestones = milestones.filter((m) => days <= m);
    if (matchedMilestones.length === 0) continue;

    for (const m of matchedMilestones) {
      const severity: NotificationSeverity =
        days <= 0 ? "CRITICAL" : m <= 7 ? "WARNING" : "INFO";
      const title =
        days <= 0
          ? `BAA with ${v.name} has expired`
          : `BAA with ${v.name} expires in ${days} day${days === 1 ? "" : "s"}`;
      const body = `The Business Associate Agreement with ${v.name} expires ${formatPracticeDate(v.baaExpiresAt, practiceTimezone)}. Renew before expiry to keep HIPAA_BAAS compliant.`;
      for (const userId of adminUserIds) {
        proposals.push({
          userId,
          practiceId,
          type: "VENDOR_BAA_EXPIRING",
          severity,
          title,
          body,
          href: "/programs/vendors",
          entityKey: `baa-expiring:${v.id}:${m}`,
        });
      }
    }
  }
  return proposals;
}

/**
 * Informational: fires once when a BAA flips to EXECUTED. Limited to
 * the last 14 days of execution events so older BAAs don't spam every
 * digest run. EntityKey is keyed only on the BaaRequest.id so it fires
 * exactly once across all digest runs.
 */
export async function generateBaaExecutedNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets
  // OWNER + ADMIN directly via PracticeUser query. Param kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  // Only consider BAAs executed in the last 14 days — older ones have
  // already been notified or naturally surface in the vendor list.
  const cutoff = new Date(Date.now() - 14 * DAY_MS);
  const requests = await tx.baaRequest.findMany({
    where: {
      practiceId,
      status: "EXECUTED",
      executedAt: { gte: cutoff },
    },
    select: {
      id: true,
      executedAt: true,
      vendor: { select: { name: true } },
    },
  });
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];

  const proposals: NotificationProposal[] = [];
  for (const r of requests) {
    if (!r.executedAt) continue;
    const title = `BAA executed: ${r.vendor.name}`;
    const body = `The Business Associate Agreement with ${r.vendor.name} was executed on ${formatPracticeDate(r.executedAt, practiceTimezone)}.`;
    for (const userId of adminUserIds) {
      proposals.push({
        userId,
        practiceId,
        type: "BAA_EXECUTED",
        severity: "INFO",
        title,
        body,
        href: "/programs/vendors",
        entityKey: `baa-executed:${r.id}`,
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
  practiceTimezone: string,
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
        body: `"${inc.title}" was determined a breach on ${formatPracticeDate(inc.discoveredAt, practiceTimezone)}. HHS OCR notification deadline is ${deadlineDaysLeft} days away. ${isMajor ? "Major-breach media notice is also required." : ""}`.trim(),
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
  // No date renders in this generator's body/title strings — practiceTimezone
  // is kept for signature consistency so generateAllNotifications can pass it
  // uniformly. Future date renders in allergy bodies should use it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
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
  // Audit #21 CR-2 (2026-04-30): filter retiredAt:null so soft-deleted
  // drills (audit #15) don't keep firing reminders.
  const lastDrill = await tx.allergyDrill.findFirst({
    where: { practiceId, retiredAt: null },
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
  // Audit #21 CR-2 (2026-04-30): filter retiredAt:null so soft-deleted
  // fridge logs (audit #15) don't suppress / reset the overdue timer.
  const lastFridge = await tx.allergyEquipmentCheck.findFirst({
    where: { practiceId, checkType: "REFRIGERATOR_TEMP", retiredAt: null },
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
  // Audit #21 CR-2 (2026-04-30): filter retiredAt:null so soft-deleted
  // kit checks (audit #15) don't keep firing the epi-expiry warning.
  const lastKit = await tx.allergyEquipmentCheck.findFirst({
    where: { practiceId, checkType: "EMERGENCY_KIT", retiredAt: null },
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
 * Staff missing current-year allergy competency. Emits ONE proposal per
 * recipient admin listing unqualified compounders (up to 5 + "and N more"
 * suffix), matching v1's ALLERGY_COMPETENCY_DUE logic.
 */
export async function generateAllergyCompetencyDueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency. See generateAllergyNotifications comment.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const enabled = await tx.practiceFramework.findFirst({
    where: {
      practiceId,
      enabled: true,
      framework: { code: "ALLERGY" },
    },
  });
  if (!enabled) return [];

  const currentYear = new Date().getFullYear();

  const [allStaff, qualifiedCompetencies] = await Promise.all([
    tx.practiceUser.findMany({
      where: { practiceId, removedAt: null, requiresAllergyCompetency: true },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    tx.allergyCompetency.findMany({
      where: { practiceId, year: currentYear, isFullyQualified: true },
      select: { practiceUserId: true },
    }),
  ]);

  const qualifiedIds = new Set(qualifiedCompetencies.map((c) => c.practiceUserId));
  const unqualified = allStaff.filter((s) => !qualifiedIds.has(s.id));

  if (unqualified.length === 0) return [];

  const names = unqualified
    .slice(0, 5)
    .map((s) =>
      `${s.user?.firstName ?? ""} ${s.user?.lastName ?? ""}`.trim() || "Staff member",
    );
  const suffix = unqualified.length > 5 ? ` and ${unqualified.length - 5} more` : "";
  const body = `The following staff do not have a current-year fully qualified allergy competency: ${names.join(", ")}${suffix}.`;

  return userIds.map((userId) => ({
    userId,
    practiceId,
    type: "ALLERGY_COMPETENCY_DUE" as NotificationType,
    severity: "WARNING" as NotificationSeverity,
    title: `${unqualified.length} staff missing ${currentYear} allergy competency`,
    body,
    href: "/programs/allergy",
    entityKey: `allergy-competency-due-${currentYear}`,
  }));
}

// ---------------------------------------------------------------------------
// Phase A — domain-scan generators (chunk 8 launch readiness)
// ---------------------------------------------------------------------------

const POLICY_REVIEW_OBLIGATION_DAYS = 365;
const TRAINING_OVERDUE_GRACE_DAYS = 90;
const CMS_CREDENTIAL_TYPE_CODES = [
  "MEDICARE_PECOS_ENROLLMENT",
  "MEDICARE_PROVIDER_ENROLLMENT",
];
const BREACH_DETERMINATION_WINDOW_DAYS = 60;
const BREACH_DETERMINATION_REMIND_AFTER_DAYS = 50;
const OSHA_POSTING_WINDOW_START = { month: 0, day: 15 }; // Jan 15 (0-based)
const OSHA_POSTING_WINDOW_END = { month: 1, day: 1 }; // Feb 1 (0-based)

/**
 * Helper: load OWNER + ADMIN PracticeUser.userIds for a practice. Used by
 * generators whose recipients are admins-only (not all members).
 */
async function ownerAdminUserIds(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<string[]> {
  const rows = await tx.practiceUser.findMany({
    where: {
      practiceId,
      removedAt: null,
      role: { in: ["OWNER", "ADMIN"] },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Annual policy-review reminder. Fires at 90/60/30 days before
 * `lastReviewedAt + 365`. Skipped when already past due (POLICY_STALE
 * handles overdue separately, deferred). Recipients are owners + admins.
 */
export async function generatePolicyReviewDueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds (digest recipient pool) is intentionally ignored — these
  // generators compute their own owner/admin recipient list. Kept for
  // signature consistency with the rest of the generators.
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  const policies = await tx.practicePolicy.findMany({
    where: {
      practiceId,
      retiredAt: null,
      lastReviewedAt: { not: null },
    },
    select: {
      id: true,
      policyCode: true,
      lastReviewedAt: true,
    },
  });

  const milestones = getEffectiveLeadTimes(reminderSettings, "policyReview");

  const proposals: NotificationProposal[] = [];
  for (const p of policies) {
    if (!p.lastReviewedAt) continue;
    const dueDate = new Date(
      p.lastReviewedAt.getTime() + POLICY_REVIEW_OBLIGATION_DAYS * DAY_MS,
    );
    const days = daysUntil(dueDate);
    if (days === null) continue;
    if (days < 0) continue; // Already overdue — POLICY_STALE territory.

    // Same milestone-cross logic as the credential renewal generator: fire
    // exactly the day a milestone threshold is crossed.
    const matched = milestones.find(
      (m) => days <= m && days > m - 1,
    );
    if (matched === undefined) continue;

    const reviewedDate = formatPracticeDate(p.lastReviewedAt, practiceTimezone);
    const dueStr = formatPracticeDate(dueDate, practiceTimezone);
    const title = `Annual review due in ${days} day${days === 1 ? "" : "s"}: ${p.policyCode}`;
    const body = `${p.policyCode} was last reviewed ${reviewedDate}. Annual review is required by ${dueStr}.`;
    const entityKey = `policy:${p.id}:milestone:${matched}`;

    for (const uid of adminIds) {
      proposals.push({
        userId: uid,
        practiceId,
        type: "POLICY_REVIEW_DUE" as NotificationType,
        severity: "INFO" as NotificationSeverity,
        title,
        body,
        href: `/policies/${p.id}`,
        entityKey,
      });
    }
  }
  return proposals;
}

/**
 * For each adopted PracticePolicy (retiredAt: null), find every active
 * PracticeUser who hasn't acknowledged the CURRENT policy version. Fires
 * once per (policy, user, version) — entityKey includes version so a
 * content update (POLICY_CONTENT_UPDATED bumps version) re-fires.
 *
 * Skip if the policy has an unfulfilled PolicyTrainingPrereq for that
 * user (the user can't acknowledge until the prereq training passes,
 * so a notification would be confusing).
 */
export async function generatePolicyAcknowledgmentPendingNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets the
  // staff member directly via the active-members query. Kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency with the rest of the generators.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const policies = await tx.practicePolicy.findMany({
    where: { practiceId, retiredAt: null },
    include: {
      acknowledgments: { select: { userId: true, policyVersion: true } },
      trainingPrereqs: { select: { trainingCourseId: true } },
    },
  });
  if (policies.length === 0) return [];

  const members = await tx.practiceUser.findMany({
    where: { practiceId, removedAt: null },
    select: { userId: true },
  });

  // Pre-fetch all passing completions for prereq checks (one query, no N+1)
  const allPasses = await tx.trainingCompletion.findMany({
    where: {
      practiceId,
      passed: true,
      expiresAt: { gt: new Date() },
    },
    select: { userId: true, courseId: true },
  });
  const passesByUser = new Map<string, Set<string>>();
  for (const p of allPasses) {
    let set = passesByUser.get(p.userId);
    if (!set) {
      set = new Set();
      passesByUser.set(p.userId, set);
    }
    set.add(p.courseId);
  }

  const proposals: NotificationProposal[] = [];
  for (const policy of policies) {
    // Build "users who have acked the CURRENT version" set
    const ackedUserIds = new Set(
      policy.acknowledgments
        .filter((a) => a.policyVersion === policy.version)
        .map((a) => a.userId),
    );
    const prereqCourseIds = policy.trainingPrereqs.map((p) => p.trainingCourseId);

    for (const m of members) {
      if (ackedUserIds.has(m.userId)) continue;
      // Prereq gating
      if (prereqCourseIds.length > 0) {
        const userPasses = passesByUser.get(m.userId) ?? new Set();
        const allPrereqsMet = prereqCourseIds.every((c) => userPasses.has(c));
        if (!allPrereqsMet) continue;
      }
      proposals.push({
        userId: m.userId,
        practiceId,
        type: "POLICY_ACKNOWLEDGMENT_PENDING",
        severity: "WARNING",
        title: `Policy review needed: ${policy.policyCode}`,
        body: `You have not acknowledged the current version (v${policy.version}) of ${policy.policyCode}. Read the policy and sign to confirm understanding.`,
        href: `/programs/policies/${policy.id}`,
        entityKey: `policy-ack-pending:${policy.id}:${policy.version}:${m.userId}`,
      });
    }
  }
  return proposals;
}

/**
 * Staff missed training renewal — 90 days past expiry. Fires a
 * notification to the staff member themselves (not admins). Suppressed
 * when a newer passing completion exists for the same (userId, courseId).
 */
export async function generateTrainingOverdueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets the
  // staff member who took the training instead. Kept for signature parity.
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const cutoff = new Date(Date.now() - TRAINING_OVERDUE_GRACE_DAYS * DAY_MS);
  const overdueCompletions = await tx.trainingCompletion.findMany({
    where: {
      practiceId,
      passed: true,
      expiresAt: { lt: cutoff },
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      expiresAt: true,
      course: { select: { title: true } },
    },
  });
  if (overdueCompletions.length === 0) return [];

  // Dedup by (userId, courseId) — keep only the newest overdue completion
  // per pair, then suppress if a newer passing completion exists.
  const newestByUserCourse = new Map<string, (typeof overdueCompletions)[number]>();
  for (const c of overdueCompletions) {
    const key = `${c.userId}:${c.courseId}`;
    const prior = newestByUserCourse.get(key);
    if (!prior || c.expiresAt > prior.expiresAt) {
      newestByUserCourse.set(key, c);
    }
  }

  // Hoisted single fetch of ALL passing completions for this practice,
  // grouped by (userId, courseId). Avoids an N+1 round-trip per overdue
  // record when checking for a superseding retake.
  const allPasses = await tx.trainingCompletion.findMany({
    where: { practiceId, passed: true },
    select: {
      id: true,
      userId: true,
      courseId: true,
      completedAt: true,
      expiresAt: true,
    },
  });
  const passesByUserCourse = new Map<string, typeof allPasses>();
  for (const p of allPasses) {
    const key = `${p.userId}:${p.courseId}`;
    const list = passesByUserCourse.get(key);
    if (list) {
      list.push(p);
    } else {
      passesByUserCourse.set(key, [p]);
    }
  }

  const proposals: NotificationProposal[] = [];
  for (const c of newestByUserCourse.values()) {
    // A retake that genuinely renewed the training supersedes the overdue
    // notification. We require BOTH:
    //   - completedAt > c.expiresAt - 365d (the retake is recent enough)
    //   - expiresAt > c.expiresAt (the retake actually pushed validity forward)
    // This avoids treating a retake-with-shorter-validity as a renewal when
    // the new expiry is still in the past.
    const candidates = passesByUserCourse.get(`${c.userId}:${c.courseId}`) ?? [];
    const completedAtCutoff = new Date(c.expiresAt.getTime() - 365 * DAY_MS);
    const newerPass = candidates.find(
      (p) =>
        p.id !== c.id &&
        p.completedAt > completedAtCutoff &&
        p.expiresAt > c.expiresAt,
    );
    if (newerPass) continue;

    const expiredOn = formatPracticeDate(c.expiresAt, practiceTimezone);
    const courseTitle = c.course?.title ?? "Required training";
    proposals.push({
      userId: c.userId,
      practiceId,
      type: "TRAINING_OVERDUE" as NotificationType,
      severity: "INFO" as NotificationSeverity,
      title: `Training overdue: ${courseTitle}`,
      body: `Your ${courseTitle} training expired on ${expiredOn} and has been overdue for ${TRAINING_OVERDUE_GRACE_DAYS} days. Retake to stay compliant.`,
      href: `/training/${c.courseId}`,
      entityKey: `training-completion:${c.id}`,
    });
  }
  return proposals;
}

// ---------------------------------------------------------------------------
// Phase 4 PR 8 — assignment-driven training notifications
// ---------------------------------------------------------------------------
//
// Four generators wired to the TrainingAssignment / TrainingCompletion
// schema added in Phase 4. They COEXIST with generateTrainingOverdueNotifications
// and generateTrainingEscalationNotifications above; entityKey prefixes are
// strictly disambiguated so dedup never collides between the completion-based
// existing generator and the assignment-based new ones.
//
//   - training-assigned:{assignmentId}:{userId}            — once per (assignment, user)
//   - training-due-soon:{assignmentId}:{userId}:{m}        — milestones 14/7/3/1 days pre-due
//   - training-overdue-assignment:{assignmentId}:{userId}:{week}
//                                                         — week-since-due index, 0+
//   - training-expiring:{completionId}:{m}                 — milestones 30/14/7 days pre-expiry
//
// Recipient resolution (assignedToUserId / assignedToRole / assignedToCategory)
// mirrors src/lib/training/resolveAssignments.ts. assignedToCategory is
// honored against PracticeUser.category once that column lands; today no
// PracticeUser carries a category, so a category-only assignment resolves
// to zero recipients (same as resolveGrid's behavior).

interface AssignmentRecipientRow {
  id: string;
  courseId: string;
  dueDate: Date | null;
  assignedToUserId: string | null;
  assignedToRole: string | null;
  assignedToCategory: string | null;
  course: { id: string; title: string };
}

interface AssignmentRecipientContext {
  assignments: AssignmentRecipientRow[];
  exclusionsByAssignment: Map<string, Set<string>>;
  // PracticeUser rows for active members: userId → role. (category is plumbed
  // through but currently always null — see resolveGrid.ts comment.)
  members: Array<{ userId: string; role: string; category: string | null }>;
  // Latest passing completion per (userId, courseId) — used to suppress
  // notifications for users who already satisfy the assignment.
  passByUserCourse: Map<string, { id: string; expiresAt: Date }>;
}

/**
 * Single shared fetcher for the three assignment-driven generators. Pulls
 * active assignments + exclusions + member roster + latest passing
 * completions in 4 round trips, regardless of how many assignments exist.
 */
async function loadAssignmentRecipientContext(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<AssignmentRecipientContext> {
  const [assignments, exclusions, members, allPasses] = await Promise.all([
    tx.trainingAssignment.findMany({
      where: { practiceId, revokedAt: null },
      select: {
        id: true,
        courseId: true,
        dueDate: true,
        assignedToUserId: true,
        assignedToRole: true,
        assignedToCategory: true,
        course: { select: { id: true, title: true } },
      },
    }),
    tx.assignmentExclusion.findMany({
      where: { assignment: { practiceId } },
      select: { assignmentId: true, userId: true },
    }),
    tx.practiceUser.findMany({
      where: { practiceId, removedAt: null },
      select: { userId: true, role: true },
    }),
    tx.trainingCompletion.findMany({
      where: { practiceId, passed: true },
      select: {
        id: true,
        userId: true,
        courseId: true,
        completedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  const exclusionsByAssignment = new Map<string, Set<string>>();
  for (const ex of exclusions) {
    const set = exclusionsByAssignment.get(ex.assignmentId);
    if (set) {
      set.add(ex.userId);
    } else {
      exclusionsByAssignment.set(ex.assignmentId, new Set([ex.userId]));
    }
  }

  // Latest passing completion per (userId, courseId). Caller wants the
  // freshest because validity windows roll forward — an old expired
  // completion shouldn't shadow a recent one.
  const passByUserCourse = new Map<string, { id: string; expiresAt: Date }>();
  for (const c of allPasses) {
    const key = `${c.userId}:${c.courseId}`;
    const prior = passByUserCourse.get(key);
    if (!prior || c.expiresAt > prior.expiresAt) {
      passByUserCourse.set(key, { id: c.id, expiresAt: c.expiresAt });
    }
  }

  return {
    assignments,
    exclusionsByAssignment,
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      // TODO(when-PracticeUser.category-lands): once the schema adds a
      // category column on PracticeUser, this path will route assignments
      // to all matching staff. The category-only test in
      // tests/integration/training-notifications.test.ts (currently asserts
      // zero proposals) will need to be updated to seed a category-tagged
      // member and assert routing.
      category: null, // PracticeUser has no per-user category column today
    })),
    passByUserCourse,
  };
}

/**
 * Resolve the eligible recipient userIds for a single assignment, given the
 * shared context. Mirrors resolveAssignmentsForUser's eligibility predicate:
 *   - assignedToUserId === user.id, OR
 *   - assignedToRole === user.role (and role is non-null on assignment), OR
 *   - assignedToCategory === user.category (and both non-null)
 *   - AND user is not in exclusionsByAssignment for this assignment
 */
function resolveAssignmentRecipients(
  assignment: AssignmentRecipientRow,
  ctx: AssignmentRecipientContext,
): string[] {
  const excluded = ctx.exclusionsByAssignment.get(assignment.id);
  const recipients: string[] = [];
  for (const m of ctx.members) {
    const isMatch =
      assignment.assignedToUserId === m.userId ||
      (assignment.assignedToRole !== null &&
        assignment.assignedToRole === m.role) ||
      (assignment.assignedToCategory !== null &&
        m.category !== null &&
        assignment.assignedToCategory === m.category);
    if (!isMatch) continue;
    if (excluded?.has(m.userId)) continue;
    recipients.push(m.userId);
  }
  return recipients;
}

/**
 * Fires once per (assignment, eligible-user) — entityKey embeds both ids
 * so a re-assignment (different assignment row) starts a fresh dedup
 * window, but a digest re-run for the same assignment is a no-op.
 *
 * Skips users who already have a passing-non-expired completion for the
 * course (no point welcoming them to a course they already finished).
 */
export async function generateTrainingAssignedNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but recipients here are computed
  // per-assignment from the assignedToUserId/Role/Category resolver.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const ctx = await loadAssignmentRecipientContext(tx, practiceId);
  if (ctx.assignments.length === 0) return [];

  const now = new Date();
  const proposals: NotificationProposal[] = [];

  for (const a of ctx.assignments) {
    const recipients = resolveAssignmentRecipients(a, ctx);
    if (recipients.length === 0) continue;

    const dueStr = a.dueDate
      ? `Due ${formatPracticeDate(a.dueDate, practiceTimezone)}.`
      : "No due date set.";
    const title = `New training assigned: ${a.course.title}`;
    const body = `You've been assigned ${a.course.title}. ${dueStr}`;

    for (const uid of recipients) {
      // Suppress for users who already hold an unexpired passing completion.
      const pass = ctx.passByUserCourse.get(`${uid}:${a.courseId}`);
      if (pass && pass.expiresAt > now) continue;

      proposals.push({
        userId: uid,
        practiceId,
        type: "TRAINING_ASSIGNED" as NotificationType,
        severity: "INFO" as NotificationSeverity,
        title,
        body,
        href: `/programs/training/${a.courseId}`,
        entityKey: `training-assigned:${a.id}:${uid}`,
      });
    }
  }
  return proposals;
}

/**
 * Fires at milestones 14 / 7 / 3 / 1 days before an assignment's dueDate.
 * Matches generateCredentialRenewalNotifications' deterministic semantic
 * (audit #21 IM-7): `days <= m` — every milestone the assignment is
 * inside of fires once, dedupes on entityKey embedding the milestone day.
 *
 * Skips:
 *   - assignments with no dueDate (nothing to remind against)
 *   - already-overdue assignments (generateTrainingOverdueAssignmentNotifications handles past-due)
 *   - users with a passing-non-expired completion for the course
 */
export async function generateTrainingDueSoonNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const ctx = await loadAssignmentRecipientContext(tx, practiceId);
  if (ctx.assignments.length === 0) return [];

  const milestones = getEffectiveLeadTimes(reminderSettings, "training");
  const now = new Date();
  const proposals: NotificationProposal[] = [];

  for (const a of ctx.assignments) {
    if (!a.dueDate) continue;
    const days = daysUntil(a.dueDate);
    if (days === null) continue;
    if (days <= 0) continue; // Past due — overdue generator territory.

    const matched = milestones.filter((m) => days <= m);
    if (matched.length === 0) continue;

    const recipients = resolveAssignmentRecipients(a, ctx);
    if (recipients.length === 0) continue;

    const dueStr = formatPracticeDate(a.dueDate, practiceTimezone);

    for (const m of matched) {
      const severity: NotificationSeverity =
        m <= 3 ? "WARNING" : "INFO";
      const title = `${a.course.title} — due in ${days} day${days === 1 ? "" : "s"}`;
      const body = `${a.course.title} is due ${dueStr}. Complete it before the deadline.`;

      for (const uid of recipients) {
        const pass = ctx.passByUserCourse.get(`${uid}:${a.courseId}`);
        if (pass && pass.expiresAt > now) continue;

        proposals.push({
          userId: uid,
          practiceId,
          type: "TRAINING_DUE_SOON" as NotificationType,
          severity,
          title,
          body,
          href: `/programs/training/${a.courseId}`,
          entityKey: `training-due-soon:${a.id}:${uid}:${m}`,
        });
      }
    }
  }
  return proposals;
}

/**
 * Fires for assignments past their dueDate where the user has no
 * passing-non-expired completion. EntityKey embeds a `weekIndex` =
 * floor((now - dueDate) / 7d) so we re-emit weekly: weekIndex 0 covers
 * day 1–7 post-due, weekIndex 1 covers 8–14, etc. Anchoring to dueDate
 * (not the calendar week) keeps the cadence stable across year-end and
 * regardless of which day of the week the cron runs.
 *
 * Distinct from generateTrainingOverdueNotifications above — that one is
 * keyed on TrainingCompletion id (a previously-passed cert that has
 * since expired). This one is keyed on a TrainingAssignment that the user
 * never completed in the first place. The entityKey prefixes
 * (training-completion: vs training-overdue-assignment:) keep the dedup
 * windows independent.
 */
export async function generateTrainingOverdueAssignmentNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const ctx = await loadAssignmentRecipientContext(tx, practiceId);
  if (ctx.assignments.length === 0) return [];

  const now = new Date();
  const nowMs = now.getTime();
  const proposals: NotificationProposal[] = [];

  for (const a of ctx.assignments) {
    if (!a.dueDate) continue;
    if (a.dueDate.getTime() >= nowMs) continue; // Not yet due — DueSoon territory.

    const msSinceDue = nowMs - a.dueDate.getTime();
    const weekIndex = Math.floor(msSinceDue / (7 * DAY_MS));
    // weekIndex 0 fires on dueDate + 1 day (exact dueDate already filtered
    // above). Subsequent weekIndex values continue weekly.

    const recipients = resolveAssignmentRecipients(a, ctx);
    if (recipients.length === 0) continue;

    const dueStr = formatPracticeDate(a.dueDate, practiceTimezone);
    // Clamp to 1: within the first 24h past dueDate, Math.floor produces 0,
    // which reads awkwardly ("overdue 0 days"). The assignment is overdue
    // the moment dueDate passes, so 1 is the floor of user-facing meaning.
    const daysOverdue = Math.max(1, Math.floor(msSinceDue / DAY_MS));
    const severity: NotificationSeverity =
      weekIndex >= 4 ? "CRITICAL" : "WARNING";
    const title = `${a.course.title} — overdue ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`;
    const body = `${a.course.title} was due ${dueStr} and hasn't been completed. Take it now to stay compliant.`;

    for (const uid of recipients) {
      const pass = ctx.passByUserCourse.get(`${uid}:${a.courseId}`);
      if (pass && pass.expiresAt > now) continue;

      proposals.push({
        userId: uid,
        practiceId,
        type: "TRAINING_OVERDUE" as NotificationType,
        severity,
        title,
        body,
        href: `/programs/training/${a.courseId}`,
        entityKey: `training-overdue-assignment:${a.id}:${uid}:${weekIndex}`,
      });
    }
  }
  return proposals;
}

/**
 * Fires at milestones 30 / 14 / 7 days before a passing TrainingCompletion's
 * expiresAt. Recipient is the user who completed the course (not admins —
 * the affected staffer is the actor). Matches the deterministic milestone
 * semantic from generateCredentialRenewalNotifications.
 *
 * Distinct from generateTrainingOverdueNotifications (which fires AFTER
 * a completion's expiry has lapsed by 90+ days). This one is the proactive
 * pre-expiry nudge.
 */
export async function generateTrainingExpiringNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but the target is the user who
  // earned the completion.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  // Pull ALL future-expiring passing completions per (userId, courseId) so
  // the latest-wins map can see a newer roll-forward row even when its
  // expiresAt lies outside the 30-day horizon. Filtering at SQL with `lte:
  // horizon` would drop the newer row and leave the older expiring row as
  // a false "latest", incorrectly nudging users who've already renewed.
  const completions = await tx.trainingCompletion.findMany({
    where: {
      practiceId,
      passed: true,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      expiresAt: true,
      course: { select: { title: true } },
    },
  });
  if (completions.length === 0) return [];

  // For each (userId, courseId), use only the LATEST passing completion.
  // A user with two passing rows for the same course has rolled forward;
  // remind on the freshest expiry, not stale ones.
  const latestByUserCourse = new Map<string, (typeof completions)[number]>();
  for (const c of completions) {
    const key = `${c.userId}:${c.courseId}`;
    const prior = latestByUserCourse.get(key);
    if (!prior || c.expiresAt > prior.expiresAt) {
      latestByUserCourse.set(key, c);
    }
  }

  const milestones = getEffectiveLeadTimes(
    reminderSettings,
    "trainingExpiring",
  );
  const proposals: NotificationProposal[] = [];
  for (const c of latestByUserCourse.values()) {
    const days = daysUntil(c.expiresAt);
    if (days === null) continue;
    if (days < 0) continue; // Already expired — TRAINING_OVERDUE handles past-expiry.

    const matched = milestones.filter((m) => days <= m);
    if (matched.length === 0) continue;

    const courseTitle = c.course?.title ?? "Required training";
    const expiryStr = formatPracticeDate(c.expiresAt, practiceTimezone);

    for (const m of matched) {
      const severity: NotificationSeverity =
        m <= 7 ? "WARNING" : "INFO";
      const title = `${courseTitle} — expires in ${days} day${days === 1 ? "" : "s"}`;
      const body = `Your ${courseTitle} certification expires ${expiryStr}. Retake before the deadline to avoid a compliance gap.`;
      proposals.push({
        userId: c.userId,
        practiceId,
        type: "TRAINING_EXPIRING" as NotificationType,
        severity,
        title,
        body,
        href: `/programs/training/${c.courseId}`,
        entityKey: `training-expiring:${c.id}:${m}`,
      });
    }
  }
  return proposals;
}

/**
 * Medicare/Medicaid revalidation reminder. Mirrors
 * generateCredentialRenewalNotifications' milestone-cross logic but
 * filtered to the two CMS credential type codes. Recipients are owners +
 * admins (CMS revalidation is an admin task, not staff).
 */
export async function generateCmsEnrollmentNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // Owner/admin-only — see comment on generatePolicyReviewDueNotifications.
  userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  const credentials = await tx.credential.findMany({
    where: {
      practiceId,
      retiredAt: null,
      expiryDate: { not: null },
      credentialType: { code: { in: CMS_CREDENTIAL_TYPE_CODES } },
    },
    select: {
      id: true,
      title: true,
      expiryDate: true,
      credentialType: { select: { code: true } },
      reminderConfig: {
        select: { enabled: true, milestoneDays: true },
      },
    },
  });

  // Per-credential reminderConfig still wins when set; per-practice
  // reminderSettings.cmsEnrollment is the fallback above the global default.
  const practiceMilestones = getEffectiveLeadTimes(
    reminderSettings,
    "cmsEnrollment",
  );

  const proposals: NotificationProposal[] = [];
  for (const cred of credentials) {
    if (!cred.expiryDate) continue;
    const config = cred.reminderConfig;
    if (config?.enabled === false) continue;
    const milestones = config?.milestoneDays?.length
      ? config.milestoneDays
      : practiceMilestones;

    const days = daysUntil(cred.expiryDate);
    if (days === null) continue;
    if (days < 0) continue;

    // Audit #21 Credentials IM-7: same fix as generateCredentialRenewalNotifications.
    // Fire every milestone we're inside of; entityKey dedup prevents repeats.
    const matchedMilestones = milestones.filter((m) => days <= m);
    if (matchedMilestones.length === 0) continue;

    const isPecos = cred.credentialType.code === "MEDICARE_PECOS_ENROLLMENT";
    const flavor = isPecos ? "PECOS" : "provider";
    const expiryStr = formatPracticeDate(cred.expiryDate, practiceTimezone);
    const title = `Medicare ${flavor} enrollment expires in ${days} day${days === 1 ? "" : "s"}`;
    const body = `Revalidation must be completed via PECOS before ${expiryStr}.`;

    for (const matched of matchedMilestones) {
      const entityKey = `cms-enrollment:${cred.id}:milestone:${matched}`;
      for (const uid of adminIds) {
        proposals.push({
          userId: uid,
          practiceId,
          type: "CMS_ENROLLMENT_EXPIRING" as NotificationType,
          severity: "INFO" as NotificationSeverity,
          title,
          body,
          href: `/credentials/${cred.id}`,
          entityKey,
        });
      }
    }
  }
  return proposals;
}

/**
 * HIPAA's 60-day breach-determination window is closing — fire when the
 * window has 10 or fewer days left (discoveredAt is between 50 and 60
 * days ago) AND the breach-determination wizard hasn't run yet. The
 * wizard atomically sets `isBreach` and `breachDeterminedAt` (see
 * src/lib/events/projections/incident.ts), so `isBreach: null` is the
 * "wizard not run" state — that's what this reminder targets. Recipients
 * are owners + admins. WARNING severity to surface urgency. NOTE: the
 * spec also mentioned the incident's `assigneeId`, but the schema
 * doesn't currently carry an assignee field on Incident; owners + admins
 * is the launch coverage and will be revisited if/when assignment ships.
 */
export async function generateBreachDeterminationDeadlineNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // Owner/admin-only — see comment on generatePolicyReviewDueNotifications.
  userIds: string[],
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  const now = Date.now();
  const windowEnd = new Date(now - BREACH_DETERMINATION_REMIND_AFTER_DAYS * DAY_MS);
  const windowStart = new Date(now - BREACH_DETERMINATION_WINDOW_DAYS * DAY_MS);

  const incidents = await tx.incident.findMany({
    where: {
      practiceId,
      // isBreach: null = breach-determination wizard hasn't run yet.
      // Once the wizard runs it sets isBreach=true|false AND breachDeterminedAt
      // atomically, exiting this reminder's target state.
      isBreach: null,
      resolvedAt: null,
      // discoveredAt > 60 days ago AND < 50 days ago = inside the window
      discoveredAt: { gt: windowStart, lt: windowEnd },
    },
    select: { id: true, title: true, discoveredAt: true },
  });

  const proposals: NotificationProposal[] = [];
  for (const inc of incidents) {
    const daysSince = Math.floor((now - inc.discoveredAt.getTime()) / DAY_MS);
    const daysLeft = Math.max(0, BREACH_DETERMINATION_WINDOW_DAYS - daysSince);
    const deadline = new Date(
      inc.discoveredAt.getTime() + BREACH_DETERMINATION_WINDOW_DAYS * DAY_MS,
    );
    const discoveredStr = formatPracticeDate(inc.discoveredAt, practiceTimezone);
    const deadlineStr = formatPracticeDate(deadline, practiceTimezone);
    const title = `Breach determination due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    const body = `Incident "${inc.title}" discovered ${discoveredStr} requires HIPAA breach determination by ${deadlineStr}. Complete the breach risk assessment.`;
    const entityKey = `breach-deadline:${inc.id}`;

    for (const uid of adminIds) {
      proposals.push({
        userId: uid,
        practiceId,
        type: "BREACH_DETERMINATION_DEADLINE_APPROACHING" as NotificationType,
        severity: "WARNING" as NotificationSeverity,
        title,
        body,
        href: `/incidents/${inc.id}`,
        entityKey,
      });
    }
  }
  return proposals;
}

/**
 * OSHA 300A annual posting reminder. Pure calendar logic — emits one
 * proposal per OSHA-enabled practice when today is between Jan 15 and
 * Feb 1 (inclusive on both ends). Outside that window: no-op. EntityKey
 * is keyed on the year of the upcoming Feb 1 deadline so the reminder
 * recurs annually without dedup colliding.
 */
export async function generateOshaPostingReminderNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // Owner/admin-only — see comment on generatePolicyReviewDueNotifications.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency. See generateAllergyNotifications comment.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const enabled = await tx.practiceFramework.findFirst({
    where: {
      practiceId,
      enabled: true,
      framework: { code: "OSHA" },
    },
  });
  if (!enabled) return [];

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  // Inclusive window: Jan 15 through Feb 1.
  const inWindow =
    (month === OSHA_POSTING_WINDOW_START.month &&
      day >= OSHA_POSTING_WINDOW_START.day) ||
    (month === OSHA_POSTING_WINDOW_END.month &&
      day <= OSHA_POSTING_WINDOW_END.day);
  if (!inWindow) return [];

  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  // EntityKey year = year of the upcoming Feb 1 deadline. If today is
  // late January, that's the current year. If today is Feb 1 itself,
  // also the current year.
  const deadlineYear = year;
  const entityKey = `osha-posting:${deadlineYear}`;

  return adminIds.map((uid) => ({
    userId: uid,
    practiceId,
    type: "OSHA_POSTING_REMINDER" as NotificationType,
    severity: "INFO" as NotificationSeverity,
    title: "OSHA 300A posting due Feb 1",
    body: "Post the OSHA 300A summary in a visible location from Feb 1 through Apr 30. Generate it from the Reports page.",
    href: "/audit/reports",
    entityKey,
  }));
}

// ---------------------------------------------------------------------------
// Phase B — notification-scan escalation generators (chunk 8 launch readiness)
// ---------------------------------------------------------------------------
//
// New "scan-then-cross-check" pattern:
//
// Every other generator in this file scans a domain table (Credential,
// PracticePolicy, Incident, …) for "needs an alert" rows. The two
// escalation generators below scan the `Notification` table itself for
// rows that meet the "old + still unread" criteria, then cross-check the
// underlying domain record to confirm the original concern is still
// actionable (e.g. the credential hasn't been renewed, the training
// hasn't been retaken). When both conditions hold, they emit a manager-
// targeted escalation.
//
// EntityKey convention: keyed on the SOURCE DOMAIN RECORD
// (`training-escalation:{completionId}`, `credential-escalation:{credentialId}`),
// NOT on the source notification's id. This keeps dedup sane — one
// escalation per overdue thing, not one per overdue notification — and
// survives the case where multiple TRAINING_OVERDUE rows exist for the
// same completion across digest runs.

const ESCALATION_THRESHOLD_DAYS = 14;

/**
 * Staff hasn't completed overdue training after 14 days → escalate to
 * managers. Source: TRAINING_OVERDUE notifications older than 14 days
 * that the staff member hasn't read. Cross-check: the underlying
 * TrainingCompletion still has no newer passing completion (same
 * supersede logic as generateTrainingOverdueNotifications). EntityKey is
 * `training-escalation:{completionId}` — keyed on the completion, not
 * the source notification, so a single overdue completion produces one
 * escalation regardless of how many source TRAINING_OVERDUE rows exist.
 */
export async function generateTrainingEscalationNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // Owner/admin-only — see comment on generatePolicyReviewDueNotifications.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency. See generateAllergyNotifications comment.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminIds = await ownerAdminUserIds(tx, practiceId);
  if (adminIds.length === 0) return [];

  const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_DAYS * DAY_MS);

  // Source query: stale unread TRAINING_OVERDUE notifications.
  const stale = await tx.notification.findMany({
    where: {
      practiceId,
      type: "TRAINING_OVERDUE",
      createdAt: { lt: cutoff },
      readAt: null,
    },
    select: { id: true, entityKey: true },
  });
  if (stale.length === 0) return [];

  // EntityKey from generateTrainingOverdueNotifications is
  // `training-completion:{completionId}` — extract the completion id.
  // Dedup on completionId here so a single overdue completion produces
  // exactly one escalation even if multiple TRAINING_OVERDUE rows
  // happen to share it across users.
  const completionIds = new Set<string>();
  for (const n of stale) {
    if (!n.entityKey) continue;
    const prefix = "training-completion:";
    if (!n.entityKey.startsWith(prefix)) continue;
    completionIds.add(n.entityKey.slice(prefix.length));
  }
  if (completionIds.size === 0) return [];

  const completions = await tx.trainingCompletion.findMany({
    where: {
      id: { in: Array.from(completionIds) },
      practiceId,
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      expiresAt: true,
      course: { select: { title: true } },
      practice: { select: { id: true } },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  // Hoisted single fetch of ALL passing completions for this practice,
  // grouped by (userId, courseId). Avoids an N+1 round-trip per stale
  // notification when checking for a superseding retake.
  const allPasses = await tx.trainingCompletion.findMany({
    where: { practiceId, passed: true },
    select: {
      id: true,
      userId: true,
      courseId: true,
      completedAt: true,
      expiresAt: true,
    },
  });
  const passesByUserCourse = new Map<string, typeof allPasses>();
  for (const p of allPasses) {
    const key = `${p.userId}:${p.courseId}`;
    const list = passesByUserCourse.get(key);
    if (list) {
      list.push(p);
    } else {
      passesByUserCourse.set(key, [p]);
    }
  }

  const proposals: NotificationProposal[] = [];
  for (const c of completions) {
    // Cross-check: still no newer passing completion (otherwise the
    // original TRAINING_OVERDUE is moot and so is its escalation). Same
    // supersede semantics as generateTrainingOverdueNotifications — a
    // retake counts only if both completedAt is recent AND expiresAt
    // pushed validity forward.
    const candidates = passesByUserCourse.get(`${c.userId}:${c.courseId}`) ?? [];
    const completedAtCutoff = new Date(c.expiresAt.getTime() - 365 * DAY_MS);
    const newerPass = candidates.find(
      (p) =>
        p.id !== c.id &&
        p.completedAt > completedAtCutoff &&
        p.expiresAt > c.expiresAt,
    );
    if (newerPass) continue;

    // Staff display name comes from the `user` include (avoids per-row findUnique).
    const staffName =
      `${c.user?.firstName ?? ""} ${c.user?.lastName ?? ""}`.trim() ||
      c.user?.email ||
      "A staff member";
    const courseTitle = c.course?.title ?? "Required training";
    const entityKey = `training-escalation:${c.id}`;
    const title = `Staff training overdue: ${staffName} — ${courseTitle}`;
    const body = `${staffName} has had overdue training for ${ESCALATION_THRESHOLD_DAYS}+ days with no completion. Follow up directly.`;

    for (const uid of adminIds) {
      proposals.push({
        userId: uid,
        practiceId,
        type: "TRAINING_ESCALATION" as NotificationType,
        severity: "WARNING" as NotificationSeverity,
        title,
        body,
        href: `/training/staff/${c.userId}`,
        entityKey,
      });
    }
  }
  return proposals;
}

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

// ---------------------------------------------------------------------------
// Phase 7 PR 4 — DEA + safety generators
// ---------------------------------------------------------------------------
//
// All four generators target OWNER + ADMIN only via ownerAdminUserIds.
// The DEA generator uses the milestone fan-out pattern matching
// generateCredentialRenewalNotifications. The other three use absence-
// based detection — fire when no qualifying record exists in the lookback
// window — with year-week or year-quarter dedup so stale practices get
// one nudge per period, not one per digest run.

/**
 * DEA biennial controlled-substance inventory due reminder.
 *
 * 21 CFR §1304.11 requires a controlled-substance inventory every 2 years.
 * Schedule: 24 months from latest DeaInventory.asOfDate. Fires at the
 * milestones from getEffectiveLeadTimes(reminderSettings, "deaInventory")
 * (default [60, 14, 1]) — same fire-all-crossed pattern as
 * generateCredentialRenewalNotifications. If no inventory has ever been
 * recorded, fires CRITICAL with no due date (entityKey is stable per-
 * practice so dedup catches re-fires).
 *
 * Gated to practices with the DEA framework enabled.
 */
export async function generateDeaBiennialInventoryDueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // userIds is the digest recipient pool, but this generator targets
  // OWNER + ADMIN directly via ownerAdminUserIds. Param kept for
  // signature parity with the fan-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  // DEA framework gating — practices without DEA enabled shouldn't see
  // biennial-inventory notifications at all.
  const dea = await tx.practiceFramework.findFirst({
    where: { practiceId, enabled: true, framework: { code: "DEA" } },
    select: { id: true },
  });
  if (!dea) return [];

  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];

  const latest = await tx.deaInventory.findFirst({
    where: { practiceId },
    orderBy: { asOfDate: "desc" },
    select: { id: true, asOfDate: true },
  });

  if (!latest) {
    // No biennial inventory has ever been recorded — fire CRITICAL once.
    // The entityKey is stable per-practice so dedup catches re-fires.
    return adminUserIds.map((userId) => ({
      userId,
      practiceId,
      type: "DEA_BIENNIAL_INVENTORY_DUE" as NotificationType,
      severity: "CRITICAL" as NotificationSeverity,
      title: "DEA biennial inventory has never been recorded",
      body: "21 CFR §1304.11 requires a biennial controlled-substance inventory. No DEA inventory exists in your records — log one to satisfy DEA compliance.",
      href: "/programs/dea/inventory",
      entityKey: `dea-biennial-never-recorded:${practiceId}`,
    }));
  }

  // 24 months from asOfDate.
  const dueDate = new Date(latest.asOfDate.getTime());
  dueDate.setUTCMonth(dueDate.getUTCMonth() + 24);
  const days = daysUntil(dueDate);
  if (days === null) return [];

  const milestones = getEffectiveLeadTimes(reminderSettings, "deaInventory");
  const matched = milestones.filter((m) => days <= m);

  const proposals: NotificationProposal[] = [];
  for (const m of matched) {
    const severity: NotificationSeverity =
      days <= 0 ? "CRITICAL" : m <= 14 ? "WARNING" : "INFO";
    const title =
      days <= 0
        ? `DEA biennial inventory is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`
        : `DEA biennial inventory due in ${days} day${days === 1 ? "" : "s"}`;
    const body = `Your last DEA biennial controlled-substance inventory was ${formatPracticeDate(latest.asOfDate, practiceTimezone)}. The next is due ${formatPracticeDate(dueDate, practiceTimezone)}.`;
    for (const userId of adminUserIds) {
      proposals.push({
        userId,
        practiceId,
        type: "DEA_BIENNIAL_INVENTORY_DUE",
        severity,
        title,
        body,
        href: "/programs/dea/inventory",
        entityKey: `dea-biennial:${latest.id}:${m}`,
      });
    }
  }
  // If overdue (days < 0) but somehow no milestones matched, fire a critical
  // "overdue" entry anyway so the practice is alerted. In practice 0 satisfies
  // any positive milestone so this fallback is a defense-in-depth path.
  if (days < 0 && proposals.length === 0) {
    for (const userId of adminUserIds) {
      proposals.push({
        userId,
        practiceId,
        type: "DEA_BIENNIAL_INVENTORY_DUE",
        severity: "CRITICAL",
        title: `DEA biennial inventory is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`,
        body: `Your last DEA biennial controlled-substance inventory was ${formatPracticeDate(latest.asOfDate, practiceTimezone)}. The next was due ${formatPracticeDate(dueDate, practiceTimezone)}.`,
        href: "/programs/dea/inventory",
        entityKey: `dea-biennial-overdue:${latest.id}`,
      });
    }
  }
  return proposals;
}

/**
 * Phishing drill due reminder.
 *
 * Fires when no PhishingDrill exists in the last 365 days. Single severity
 * (INFO). Year-week dedup so a stale practice gets one notification per
 * week, not one per digest run.
 *
 * HIPAA Security Rule §164.308(a)(5) requires periodic security awareness
 * training, and cyber insurance carriers treat regular phishing simulation
 * as a baseline workforce-awareness control.
 */
export async function generatePhishingDrillDueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // No date renders in this generator's body/title strings — kept for
  // signature consistency with the rest of the generators.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];
  const cutoff = new Date(Date.now() - 365 * DAY_MS);
  const recent = await tx.phishingDrill.findFirst({
    where: { practiceId, conductedAt: { gte: cutoff } },
    select: { id: true },
  });
  if (recent) return [];

  // Year-week dedup so a stale practice gets ONE notification per week,
  // not daily.
  const now = new Date();
  const yearWeek = `${now.getUTCFullYear()}-W${getIsoWeek(now)}`;
  const proposals: NotificationProposal[] = [];
  for (const userId of adminUserIds) {
    proposals.push({
      userId,
      practiceId,
      type: "PHISHING_DRILL_DUE",
      severity: "INFO",
      title: "Annual phishing drill is due",
      body: "HIPAA Security Rule §164.308 requires periodic security awareness training. No phishing drill has been logged in the last 365 days. Run a drill (Internal or via vendor) and log the results.",
      href: "/programs/security",
      entityKey: `phishing-drill-due:${practiceId}:${yearWeek}`,
    });
  }
  return proposals;
}

/**
 * Backup verification overdue reminder.
 *
 * Fires when no SUCCESSFUL BackupVerification exists in the last 90 days.
 * The HHS Ransomware Fact Sheet treats untested backups as effectively
 * no backups. Failed restore tests don't reset the clock — only success.
 * Year-week dedup so a stale practice gets one nudge per week.
 */
export async function generateBackupVerificationOverdueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];
  const cutoff = new Date(Date.now() - 90 * DAY_MS);
  const recent = await tx.backupVerification.findFirst({
    where: { practiceId, success: true, verifiedAt: { gte: cutoff } },
    select: { id: true, verifiedAt: true },
  });
  if (recent) return [];

  // Year-week dedup.
  const now = new Date();
  const yearWeek = `${now.getUTCFullYear()}-W${getIsoWeek(now)}`;
  const proposals: NotificationProposal[] = [];
  for (const userId of adminUserIds) {
    proposals.push({
      userId,
      practiceId,
      type: "BACKUP_VERIFICATION_OVERDUE",
      severity: "WARNING",
      title: "Backup restore test is overdue",
      body: "HIPAA Security Rule §164.308(a)(7)(ii)(D) requires periodic testing of backup restores. No successful restore test has been logged in the last 90 days. Run a test restore and log the result.",
      href: "/programs/security",
      entityKey: `backup-overdue:${practiceId}:${yearWeek}`,
    });
  }
  return proposals;
}

/**
 * Document destruction overdue reminder.
 *
 * Fires when no DestructionLog has been recorded in the last 12 months.
 * Phase 10 will eventually surface state-retention rules to drive this
 * more precisely; for now, the absence of any destruction logs is the
 * signal — practices should be running routine destruction (medical
 * records, billing, HR).
 *
 * Quarterly dedup (year-quarter) so practices that haven't run destruction
 * in years still get ONE quarterly nudge, not weekly.
 *
 * Known false-positive: a brand-new practice with no records to destroy
 * yet will still trigger this after 12 months. V1-acceptable.
 */
export async function generateDocumentDestructionOverdueNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const adminUserIds = await ownerAdminUserIds(tx, practiceId);
  if (adminUserIds.length === 0) return [];
  const cutoff = new Date(Date.now() - 365 * DAY_MS);
  const recent = await tx.destructionLog.findFirst({
    where: { practiceId, destroyedAt: { gte: cutoff } },
    select: { id: true },
  });
  if (recent) return [];

  // Quarterly dedup (year-quarter).
  const now = new Date();
  const yearQuarter = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  const proposals: NotificationProposal[] = [];
  for (const userId of adminUserIds) {
    proposals.push({
      userId,
      practiceId,
      type: "DOCUMENT_DESTRUCTION_OVERDUE",
      severity: "INFO",
      title: "Document destruction has not been logged recently",
      body: "Routine document destruction (medical records, billing, HR) is required by state retention rules. No destruction log has been recorded in the last 12 months. Log any destruction events you've completed, or schedule a destruction run.",
      href: "/programs/document-retention",
      entityKey: `doc-destruction-overdue:${practiceId}:${yearQuarter}`,
    });
  }
  return proposals;
}

// ---------------------------------------------------------------------------
// Phase 7 PR 5: welcome + system-broadcast generators
// ---------------------------------------------------------------------------
//
// generateWelcomeNotifications fires once per newly-added PracticeUser
// (joinedAt within the past day). entityKey scopes to PracticeUser.id so
// re-adding a user (new PracticeUser row, even if same userId) re-fires.
//
// generateSystemNotifications is a no-op stub for now. The
// SYSTEM_NOTIFICATION enum value is reserved for an admin-broadcast UI
// that lands in a future phase — wiring it into the fan-in here keeps
// the surface in lock-step with the enum definition.

/**
 * Welcome new PracticeUsers added in the last 24h. Single INFO-severity
 * row per user. The 1-day window is intentional — if the digest cron is
 * broken for >1d, missed welcome notifications stay missed (we'd rather
 * skip them than spam a now-week-old new hire). entityKey is keyed on
 * the PracticeUser.id (not userId) so a user who leaves and rejoins
 * gets a fresh welcome.
 */
export async function generateWelcomeNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  const cutoff = new Date(Date.now() - DAY_MS);
  const newMembers = await tx.practiceUser.findMany({
    where: {
      practiceId,
      joinedAt: { gte: cutoff },
      removedAt: null,
    },
    select: { id: true, userId: true },
  });
  if (newMembers.length === 0) return [];

  return newMembers.map((m) => ({
    userId: m.userId,
    practiceId,
    type: "WELCOME" as NotificationType,
    severity: "INFO" as NotificationSeverity,
    title: "Welcome to GuardWell!",
    body: "We're glad to have you on the team. Visit your dashboard to see what compliance tasks are assigned to you.",
    href: "/dashboard",
    entityKey: `welcome:${m.id}`,
  }));
}

/**
 * SYSTEM_NOTIFICATION skeleton. No production firing path yet — the
 * admin-broadcast UI lands in a future phase. Wired into the fan-in so
 * the enum surface and generator surface stay aligned; returns an empty
 * array unconditionally for now.
 */
export async function generateSystemNotifications(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _tx: Prisma.TransactionClient,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _practiceTimezone: string,
): Promise<NotificationProposal[]> {
  // TODO(future-phase): admin broadcast UI lands later. For now, this is
  // a no-op stub so the SYSTEM_NOTIFICATION enum value is wired into the
  // fan-in without any production firing path.
  return [];
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
  practiceTimezone: string,
  reminderSettings: unknown,
): Promise<NotificationProposal[]> {
  if (userIds.length === 0) return [];
  const [
    sra,
    creds,
    credRenewals,
    credEscalation,
    cmsEnrollment,
    baaSignaturePending,
    baaExpiring,
    baaExecuted,
    incidents,
    breachDeadline,
    policies,
    policyAck,
    training,
    trainingEscalation,
    trainingAssigned,
    trainingDueSoon,
    trainingOverdueAssignment,
    trainingExpiring,
    osha,
    allergy,
    allergyCompetency,
    deaBiennial,
    phishingDrill,
    backupVerification,
    documentDestruction,
    welcome,
    system,
  ] = await Promise.all([
    generateSraNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCredentialNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCredentialRenewalNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateCredentialEscalationNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCmsEnrollmentNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateBaaSignaturePendingNotifications(tx, practiceId, userIds, practiceTimezone),
    generateBaaExpiringNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateBaaExecutedNotifications(tx, practiceId, userIds, practiceTimezone),
    generateIncidentNotifications(tx, practiceId, userIds, practiceTimezone),
    generateBreachDeterminationDeadlineNotifications(tx, practiceId, userIds, practiceTimezone),
    generatePolicyReviewDueNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generatePolicyAcknowledgmentPendingNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingOverdueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingEscalationNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingAssignedNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingDueSoonNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateTrainingOverdueAssignmentNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingExpiringNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generateOshaPostingReminderNotifications(tx, practiceId, userIds, practiceTimezone),
    generateAllergyNotifications(tx, practiceId, userIds, practiceTimezone),
    generateAllergyCompetencyDueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateDeaBiennialInventoryDueNotifications(tx, practiceId, userIds, practiceTimezone, reminderSettings),
    generatePhishingDrillDueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateBackupVerificationOverdueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateDocumentDestructionOverdueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateWelcomeNotifications(tx, practiceId, userIds, practiceTimezone),
    generateSystemNotifications(tx, practiceId, userIds, practiceTimezone),
  ]);
  return [
    ...sra,
    ...creds,
    ...credRenewals,
    ...credEscalation,
    ...cmsEnrollment,
    ...baaSignaturePending,
    ...baaExpiring,
    ...baaExecuted,
    ...incidents,
    ...breachDeadline,
    ...policies,
    ...policyAck,
    ...training,
    ...trainingEscalation,
    ...trainingAssigned,
    ...trainingDueSoon,
    ...trainingOverdueAssignment,
    ...trainingExpiring,
    ...osha,
    ...allergy,
    ...allergyCompetency,
    ...deaBiennial,
    ...phishingDrill,
    ...backupVerification,
    ...documentDestruction,
    ...welcome,
    ...system,
  ];
}
