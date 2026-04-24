// src/lib/calendar/upcoming.ts
//
// Aggregates "deadlines coming up" from every deadline-bearing model
// in the practice. Used by /audit/calendar to give the practice owner
// one place to scan all overdue + soon-due obligations.
//
// Deadlines come from 8 sources (each with its own due-date math):
//   - Training completions      → expiresAt
//   - BAAs                      → vendor.baaExpiresAt
//   - Credentials               → expiryDate
//   - Policy reviews            → lastReviewedAt + 365d
//   - Backup verifications      → verifiedAt + 90d (due 90d after last)
//   - Phishing drills           → conductedAt + 183d (due 6mo after last)
//   - Document destruction      → destroyedAt + 365d (due annually)
//   - SRA refresh               → completedAt + 365d
//
// Each deadline is normalized to { kind, label, dueAt, sourceId,
// detailHref, severity }. The page sorts by dueAt asc, groups by
// "Overdue", "Next 7 days", "Next 30 days", "Next 90 days", "Later".

import type { Prisma, PrismaClient } from "@prisma/client";

export type DeadlineSeverity = "OVERDUE" | "URGENT" | "UPCOMING";

export interface UpcomingDeadline {
  kind:
    | "TRAINING"
    | "BAA"
    | "CREDENTIAL"
    | "POLICY_REVIEW"
    | "BACKUP_VERIFICATION"
    | "PHISHING_DRILL"
    | "DOCUMENT_DESTRUCTION"
    | "SRA_REFRESH";
  label: string;          // user-facing summary (e.g. "BBP training expires for Sarah Lee")
  detail?: string;        // optional second line
  dueAt: Date;
  sourceId: string;       // primary key of the row driving this deadline
  detailHref: string;     // /programs/training, /programs/credentials, etc.
  severity: DeadlineSeverity;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const POLICY_REVIEW_WINDOW_MS = 365 * DAY_MS;
const BACKUP_WINDOW_MS = 90 * DAY_MS;
const PHISHING_WINDOW_MS = 183 * DAY_MS;
const DESTRUCTION_WINDOW_MS = 365 * DAY_MS;
const SRA_WINDOW_MS = 365 * DAY_MS;

type DbClient = PrismaClient | Prisma.TransactionClient;

function toSeverity(dueAt: Date, now: Date): DeadlineSeverity {
  const diffMs = dueAt.getTime() - now.getTime();
  if (diffMs < 0) return "OVERDUE";
  if (diffMs <= 30 * DAY_MS) return "URGENT";
  return "UPCOMING";
}

export async function loadUpcomingDeadlines(
  db: DbClient,
  practiceId: string,
  options: { horizonDays?: number } = {},
): Promise<UpcomingDeadline[]> {
  const now = new Date();
  const horizonDays = options.horizonDays ?? 90;
  const horizon = new Date(now.getTime() + horizonDays * DAY_MS);
  const overdueFloor = new Date(now.getTime() - 365 * DAY_MS); // don't surface ancient overdue items
  const out: UpcomingDeadline[] = [];

  // ── Training completions ──────────────────────────────────────────
  const trainingRows = await db.trainingCompletion.findMany({
    where: {
      practiceId,
      passed: true,
      expiresAt: { gte: overdueFloor, lte: horizon },
    },
    orderBy: { expiresAt: "asc" },
    select: {
      id: true,
      expiresAt: true,
      course: { select: { code: true, title: true } },
    },
  });
  // Latest completion per (userId, courseId) is what counts; group + dedup.
  // For MVP, just include each row — duplicates are rare in practice and
  // overstating training-due is conservative for the calendar.
  for (const r of trainingRows) {
    out.push({
      kind: "TRAINING",
      label: `${r.course.title} expires`,
      dueAt: r.expiresAt,
      sourceId: r.id,
      detailHref: "/programs/training",
      severity: toSeverity(r.expiresAt, now),
    });
  }

  // ── BAAs ──────────────────────────────────────────────────────────
  const baaRows = await db.vendor.findMany({
    where: {
      practiceId,
      retiredAt: null,
      baaExpiresAt: { gte: overdueFloor, lte: horizon },
    },
    orderBy: { baaExpiresAt: "asc" },
    select: { id: true, name: true, baaExpiresAt: true },
  });
  for (const r of baaRows) {
    if (!r.baaExpiresAt) continue;
    out.push({
      kind: "BAA",
      label: `${r.name} BAA expires`,
      dueAt: r.baaExpiresAt,
      sourceId: r.id,
      detailHref: "/programs/vendors",
      severity: toSeverity(r.baaExpiresAt, now),
    });
  }

  // ── Credentials ───────────────────────────────────────────────────
  const credRows = await db.credential.findMany({
    where: {
      practiceId,
      retiredAt: null,
      expiryDate: { gte: overdueFloor, lte: horizon },
    },
    orderBy: { expiryDate: "asc" },
    select: {
      id: true,
      expiryDate: true,
      credentialType: { select: { name: true } },
    },
  });
  for (const r of credRows) {
    if (!r.expiryDate) continue;
    out.push({
      kind: "CREDENTIAL",
      label: `${r.credentialType?.name ?? "Credential"} expires`,
      dueAt: r.expiryDate,
      sourceId: r.id,
      detailHref: "/programs/credentials",
      severity: toSeverity(r.expiryDate, now),
    });
  }

  // ── Policy reviews ────────────────────────────────────────────────
  const policyRows = await db.practicePolicy.findMany({
    where: {
      practiceId,
      retiredAt: null,
      lastReviewedAt: { not: null },
    },
    select: { id: true, policyCode: true, lastReviewedAt: true },
  });
  for (const r of policyRows) {
    if (!r.lastReviewedAt) continue;
    const dueAt = new Date(r.lastReviewedAt.getTime() + POLICY_REVIEW_WINDOW_MS);
    if (dueAt < overdueFloor || dueAt > horizon) continue;
    out.push({
      kind: "POLICY_REVIEW",
      label: `${r.policyCode.replace(/_/g, " ")} annual review due`,
      dueAt,
      sourceId: r.id,
      detailHref: "/programs/policies",
      severity: toSeverity(dueAt, now),
    });
  }

  // ── Backup verification (due 90d after last) ──────────────────────
  const lastBackup = await db.backupVerification.findFirst({
    where: { practiceId, success: true },
    orderBy: { verifiedAt: "desc" },
    select: { id: true, verifiedAt: true, scope: true },
  });
  if (lastBackup) {
    const dueAt = new Date(lastBackup.verifiedAt.getTime() + BACKUP_WINDOW_MS);
    if (dueAt < horizon) {
      out.push({
        kind: "BACKUP_VERIFICATION",
        label: `Backup restore-test (${lastBackup.scope}) due`,
        detail: "≥1 successful test required every 90 days",
        dueAt,
        sourceId: lastBackup.id,
        detailHref: "/programs/cybersecurity",
        severity: toSeverity(dueAt, now),
      });
    }
  }

  // ── Phishing drill (due 6mo after last) ───────────────────────────
  const lastPhish = await db.phishingDrill.findFirst({
    where: { practiceId },
    orderBy: { conductedAt: "desc" },
    select: { id: true, conductedAt: true },
  });
  if (lastPhish) {
    const dueAt = new Date(lastPhish.conductedAt.getTime() + PHISHING_WINDOW_MS);
    if (dueAt < horizon) {
      out.push({
        kind: "PHISHING_DRILL",
        label: "Phishing drill due",
        detail: "≥1 drill required every 6 months",
        dueAt,
        sourceId: lastPhish.id,
        detailHref: "/programs/cybersecurity",
        severity: toSeverity(dueAt, now),
      });
    }
  }

  // ── Document destruction cadence ──────────────────────────────────
  const lastDestruction = await db.destructionLog.findFirst({
    where: { practiceId },
    orderBy: { destroyedAt: "desc" },
    select: { id: true, destroyedAt: true },
  });
  if (lastDestruction) {
    const dueAt = new Date(
      lastDestruction.destroyedAt.getTime() + DESTRUCTION_WINDOW_MS,
    );
    if (dueAt < horizon) {
      out.push({
        kind: "DOCUMENT_DESTRUCTION",
        label: "Annual document destruction cadence due",
        detail: "≥1 logged destruction event required per 365 days",
        dueAt,
        sourceId: lastDestruction.id,
        detailHref: "/programs/document-retention",
        severity: toSeverity(dueAt, now),
      });
    }
  }

  // ── SRA refresh ───────────────────────────────────────────────────
  const lastSra = await db.practiceSraAssessment.findFirst({
    where: { practiceId, isDraft: false, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { id: true, completedAt: true },
  });
  if (lastSra?.completedAt) {
    const dueAt = new Date(lastSra.completedAt.getTime() + SRA_WINDOW_MS);
    if (dueAt < horizon) {
      out.push({
        kind: "SRA_REFRESH",
        label: "Security Risk Assessment refresh due",
        detail: "OCR expects an SRA at least annually",
        dueAt,
        sourceId: lastSra.id,
        detailHref: "/programs/risk",
        severity: toSeverity(dueAt, now),
      });
    }
  }

  // Sort by dueAt ascending — overdue items first.
  out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return out;
}

/** Group deadlines into time-boxed buckets for UI rendering. */
export interface DeadlineBucket {
  key: "OVERDUE" | "WEEK" | "MONTH" | "QUARTER" | "LATER";
  label: string;
  items: UpcomingDeadline[];
}

export function bucketDeadlines(
  deadlines: UpcomingDeadline[],
  now: Date = new Date(),
): DeadlineBucket[] {
  const buckets: Record<DeadlineBucket["key"], UpcomingDeadline[]> = {
    OVERDUE: [],
    WEEK: [],
    MONTH: [],
    QUARTER: [],
    LATER: [],
  };
  for (const d of deadlines) {
    const diffMs = d.dueAt.getTime() - now.getTime();
    if (diffMs < 0) buckets.OVERDUE.push(d);
    else if (diffMs <= 7 * DAY_MS) buckets.WEEK.push(d);
    else if (diffMs <= 30 * DAY_MS) buckets.MONTH.push(d);
    else if (diffMs <= 90 * DAY_MS) buckets.QUARTER.push(d);
    else buckets.LATER.push(d);
  }
  return [
    { key: "OVERDUE", label: "Overdue", items: buckets.OVERDUE },
    { key: "WEEK", label: "Next 7 days", items: buckets.WEEK },
    { key: "MONTH", label: "Next 30 days", items: buckets.MONTH },
    { key: "QUARTER", label: "Next 90 days", items: buckets.QUARTER },
    { key: "LATER", label: "Later", items: buckets.LATER },
  ];
}
