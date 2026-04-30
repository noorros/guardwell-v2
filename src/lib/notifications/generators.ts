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
  const DEFAULT_MILESTONES = [90, 60, 30, 7];

  for (const cred of credentials) {
    if (!cred.expiryDate) continue;
    const config = cred.reminderConfig;
    // Default to enabled when no config exists; explicit disable opts out.
    if (config?.enabled === false) continue;
    const milestones = config?.milestoneDays?.length
      ? config.milestoneDays
      : DEFAULT_MILESTONES;

    const days = daysUntil(cred.expiryDate);
    if (days === null) continue;
    if (days < 0) continue; // Already expired — CREDENTIAL_EXPIRING handles past-expiry.

    // Find the milestone day that has been crossed in the last 24h
    // (days <= milestone but days > milestone - 1). Avoids re-firing
    // every day until expiry — only the day the threshold flips.
    const matchedMilestone = milestones.find(
      (m) => days <= m && days > m - 1,
    );
    if (matchedMilestone === undefined) continue;

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
  return proposals;
}

/**
 * Vendor BAAs expiring within 60 days. Same shape as credential warnings.
 */
export async function generateVendorBaaNotifications(
  tx: Prisma.TransactionClient,
  practiceId: string,
  userIds: string[],
  practiceTimezone: string,
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
    const body = `The Business Associate Agreement with ${v.name} expires ${formatPracticeDate(v.baaExpiresAt, practiceTimezone)}. Renew before expiry to keep HIPAA_BAAS compliant.`;
    // entityKey is a UTC-stable dedup hash — do NOT replace with formatPracticeDate
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
const POLICY_REVIEW_MILESTONES = [90, 60, 30];
const TRAINING_OVERDUE_GRACE_DAYS = 90;
const CMS_DEFAULT_MILESTONES = [90, 60, 30, 7];
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
    const matched = POLICY_REVIEW_MILESTONES.find(
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

  const proposals: NotificationProposal[] = [];
  for (const cred of credentials) {
    if (!cred.expiryDate) continue;
    const config = cred.reminderConfig;
    if (config?.enabled === false) continue;
    const milestones = config?.milestoneDays?.length
      ? config.milestoneDays
      : CMS_DEFAULT_MILESTONES;

    const days = daysUntil(cred.expiryDate);
    if (days === null) continue;
    if (days < 0) continue;

    const matched = milestones.find((m) => days <= m && days > m - 1);
    if (matched === undefined) continue;

    const isPecos = cred.credentialType.code === "MEDICARE_PECOS_ENROLLMENT";
    const flavor = isPecos ? "PECOS" : "provider";
    const expiryStr = formatPracticeDate(cred.expiryDate, practiceTimezone);
    const title = `Medicare ${flavor} enrollment expires in ${days} day${days === 1 ? "" : "s"}`;
    const body = `Revalidation must be completed via PECOS before ${expiryStr}.`;
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
): Promise<NotificationProposal[]> {
  if (userIds.length === 0) return [];
  const [
    sra,
    creds,
    credRenewals,
    credEscalation,
    cmsEnrollment,
    vendors,
    incidents,
    breachDeadline,
    policies,
    training,
    trainingEscalation,
    osha,
    allergy,
    allergyCompetency,
  ] = await Promise.all([
    generateSraNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCredentialNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCredentialRenewalNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCredentialEscalationNotifications(tx, practiceId, userIds, practiceTimezone),
    generateCmsEnrollmentNotifications(tx, practiceId, userIds, practiceTimezone),
    generateVendorBaaNotifications(tx, practiceId, userIds, practiceTimezone),
    generateIncidentNotifications(tx, practiceId, userIds, practiceTimezone),
    generateBreachDeterminationDeadlineNotifications(tx, practiceId, userIds, practiceTimezone),
    generatePolicyReviewDueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingOverdueNotifications(tx, practiceId, userIds, practiceTimezone),
    generateTrainingEscalationNotifications(tx, practiceId, userIds, practiceTimezone),
    generateOshaPostingReminderNotifications(tx, practiceId, userIds, practiceTimezone),
    generateAllergyNotifications(tx, practiceId, userIds, practiceTimezone),
    generateAllergyCompetencyDueNotifications(tx, practiceId, userIds, practiceTimezone),
  ]);
  return [
    ...sra,
    ...creds,
    ...credRenewals,
    ...credEscalation,
    ...cmsEnrollment,
    ...vendors,
    ...incidents,
    ...breachDeadline,
    ...policies,
    ...training,
    ...trainingEscalation,
    ...osha,
    ...allergy,
    ...allergyCompetency,
  ];
}
