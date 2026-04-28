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
    const body = `This credential expires ${cred.expiryDate.toISOString().slice(0, 10)}. Plan the renewal now to avoid a compliance gap.`;

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
 * Staff missing current-year allergy competency. Emits ONE proposal per
 * recipient admin listing unqualified compounders (up to 5 + "and N more"
 * suffix), matching v1's ALLERGY_COMPETENCY_DUE logic.
 */
export async function generateAllergyCompetencyDueNotifications(
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
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

    const reviewedDate = p.lastReviewedAt.toISOString().slice(0, 10);
    const dueStr = dueDate.toISOString().slice(0, 10);
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
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

  const proposals: NotificationProposal[] = [];
  for (const c of newestByUserCourse.values()) {
    // A newer passing completion (any expiry) supersedes this overdue
    // record. We compare by completedAt rather than expiresAt because a
    // retake might have a different expiry-window; the act of retaking
    // and passing is what clears the overdue state.
    const newerPass = await tx.trainingCompletion.findFirst({
      where: {
        practiceId,
        userId: c.userId,
        courseId: c.courseId,
        passed: true,
        completedAt: {
          gt: new Date(c.expiresAt.getTime() - 365 * DAY_MS),
        },
        id: { not: c.id },
        expiresAt: { gt: c.expiresAt },
      },
      select: { id: true },
    });
    if (newerPass) continue;

    const expiredOn = c.expiresAt.toISOString().slice(0, 10);
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
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
    const expiryStr = cred.expiryDate.toISOString().slice(0, 10);
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userIds: string[],
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
    const discoveredStr = inc.discoveredAt.toISOString().slice(0, 10);
    const deadlineStr = deadline.toISOString().slice(0, 10);
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
  const [
    sra,
    creds,
    credRenewals,
    cmsEnrollment,
    vendors,
    incidents,
    breachDeadline,
    policies,
    training,
    osha,
    allergy,
    allergyCompetency,
  ] = await Promise.all([
    generateSraNotifications(tx, practiceId, userIds),
    generateCredentialNotifications(tx, practiceId, userIds),
    generateCredentialRenewalNotifications(tx, practiceId, userIds),
    generateCmsEnrollmentNotifications(tx, practiceId, userIds),
    generateVendorBaaNotifications(tx, practiceId, userIds),
    generateIncidentNotifications(tx, practiceId, userIds),
    generateBreachDeterminationDeadlineNotifications(tx, practiceId, userIds),
    generatePolicyReviewDueNotifications(tx, practiceId, userIds),
    generateTrainingOverdueNotifications(tx, practiceId, userIds),
    generateOshaPostingReminderNotifications(tx, practiceId, userIds),
    generateAllergyNotifications(tx, practiceId, userIds),
    generateAllergyCompetencyDueNotifications(tx, practiceId, userIds),
  ]);
  return [
    ...sra,
    ...creds,
    ...credRenewals,
    ...cmsEnrollment,
    ...vendors,
    ...incidents,
    ...breachDeadline,
    ...policies,
    ...training,
    ...osha,
    ...allergy,
    ...allergyCompetency,
  ];
}
