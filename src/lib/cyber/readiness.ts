// src/lib/cyber/readiness.ts
//
// Computes a single 0-100 cybersecurity readiness score for a practice
// from existing tables. Used by /programs/cybersecurity AND by the
// HIPAA module page Section G CyberReadinessPanel.
//
// The score breaks down into five weighted components:
//   - 25 pts — All 4 cyber courses ≥80% workforce completion
//   - 25 pts — MFA enrolled for ≥80% of active workforce
//   - 25 pts — Phishing drill within last 6 months AND click rate <10%
//   - 15 pts — Successful backup restore-test within last 90 days
//   - 10 pts — At least one PHI tech asset with FULL_DISK or FIELD_LEVEL
//
// Scoring is binary per component (you get the full points or zero) for
// MVP simplicity. A future iteration can introduce partial credit.

import type { Prisma, PrismaClient } from "@prisma/client";

export const CYBER_COURSE_CODES = [
  "PHISHING_RECOGNITION_RESPONSE",
  "MFA_AUTHENTICATION_HYGIENE",
  "RANSOMWARE_DEFENSE_PLAYBOOK",
  "CYBERSECURITY_MEDICAL_OFFICES",
] as const;

export interface CyberComponentScore {
  key: string;
  label: string;
  earned: number;
  max: number;
  status: "PASS" | "FAIL" | "NOT_STARTED";
  detail: string;
}

export interface CyberReadinessSnapshot {
  total: number;
  components: CyberComponentScore[];
  // Raw signals for the UI cards.
  workforceTotal: number;
  workforceWithMfa: number;
  phishingDrillCount: number;
  recentPhishingDrill: {
    conductedAt: Date;
    clickRate: number;
    reportRate: number;
    vendor: string | null;
  } | null;
  backupVerificationCount: number;
  recentBackupVerification: {
    verifiedAt: Date;
    scope: string;
    success: boolean;
  } | null;
  encryptedPhiAssetCount: number;
  totalPhiAssetCount: number;
  cyberCoursesByUserCovered: number;
}

const PHISHING_WINDOW_MS = 183 * 24 * 60 * 60 * 1000;
const BACKUP_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MFA_THRESHOLD = 0.8;
const TRAINING_THRESHOLD = 0.8;
const PHISHING_CLICK_RATE_TARGET = 0.1;

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function computeCyberReadiness(
  db: DbClient,
  practiceId: string,
): Promise<CyberReadinessSnapshot> {
  const now = new Date();

  // Workforce + MFA coverage
  const activeUsers = await db.practiceUser.findMany({
    where: { practiceId, removedAt: null },
    select: { userId: true, mfaEnrolledAt: true },
  });
  const workforceTotal = activeUsers.length;
  const workforceWithMfa = activeUsers.filter(
    (u) => u.mfaEnrolledAt !== null,
  ).length;
  const mfaCoverage = workforceTotal > 0 ? workforceWithMfa / workforceTotal : 0;

  // Cyber training coverage (workforce members who passed ALL 4 courses,
  // non-expired)
  const cyberCourses = await db.trainingCourse.findMany({
    where: { code: { in: [...CYBER_COURSE_CODES] } },
    select: { id: true, code: true },
  });
  const cyberCourseIds = cyberCourses.map((c) => c.id);
  const allCyberCoursesSeeded = cyberCourses.length === CYBER_COURSE_CODES.length;
  let cyberCoursesByUserCovered = 0;
  if (allCyberCoursesSeeded && workforceTotal > 0) {
    const completions = await db.trainingCompletion.findMany({
      where: {
        practiceId,
        courseId: { in: cyberCourseIds },
        passed: true,
        expiresAt: { gt: now },
      },
      select: { userId: true, courseId: true },
    });
    const byUser = new Map<string, Set<string>>();
    for (const c of completions) {
      const set = byUser.get(c.userId) ?? new Set<string>();
      set.add(c.courseId);
      byUser.set(c.userId, set);
    }
    cyberCoursesByUserCovered = activeUsers.filter((u) => {
      const done = byUser.get(u.userId);
      if (!done) return false;
      return cyberCourseIds.every((id) => done.has(id));
    }).length;
  }
  const trainingCoverage =
    workforceTotal > 0 ? cyberCoursesByUserCovered / workforceTotal : 0;

  // Phishing — most recent drill in window + click rate
  const phishingCutoff = new Date(now.getTime() - PHISHING_WINDOW_MS);
  const phishingDrillCount = await db.phishingDrill.count({
    where: { practiceId },
  });
  const recentDrill = await db.phishingDrill.findFirst({
    where: { practiceId, conductedAt: { gte: phishingCutoff } },
    orderBy: { conductedAt: "desc" },
    select: {
      conductedAt: true,
      vendor: true,
      totalRecipients: true,
      clickedCount: true,
      reportedCount: true,
    },
  });

  // Backup verification — most recent successful test in window
  const backupCutoff = new Date(now.getTime() - BACKUP_WINDOW_MS);
  const backupVerificationCount = await db.backupVerification.count({
    where: { practiceId },
  });
  const recentBackup = await db.backupVerification.findFirst({
    where: {
      practiceId,
      success: true,
      verifiedAt: { gte: backupCutoff },
    },
    orderBy: { verifiedAt: "desc" },
    select: { verifiedAt: true, scope: true, success: true },
  });

  // Encryption on PHI assets
  const phiAssets = await db.techAsset.findMany({
    where: { practiceId, retiredAt: null, processesPhi: true },
    select: { encryption: true },
  });
  const totalPhiAssetCount = phiAssets.length;
  const encryptedPhiAssetCount = phiAssets.filter(
    (a) => a.encryption === "FULL_DISK" || a.encryption === "FIELD_LEVEL",
  ).length;

  // Component scores
  const components: CyberComponentScore[] = [
    {
      key: "TRAINING",
      label: "Cyber training (4 courses, ≥80% workforce)",
      max: 25,
      ...(workforceTotal === 0
        ? {
            earned: 0,
            status: "NOT_STARTED" as const,
            detail: "Add staff to begin tracking training coverage.",
          }
        : !allCyberCoursesSeeded
          ? {
              earned: 0,
              status: "NOT_STARTED" as const,
              detail:
                "Cyber course catalog not fully seeded — re-run npm run db:seed:training.",
            }
          : trainingCoverage >= TRAINING_THRESHOLD
            ? {
                earned: 25,
                status: "PASS" as const,
                detail: `${cyberCoursesByUserCovered}/${workforceTotal} staff completed all 4 courses (${pct(trainingCoverage)}).`,
              }
            : {
                earned: 0,
                status: "FAIL" as const,
                detail: `${cyberCoursesByUserCovered}/${workforceTotal} staff completed all 4 courses (${pct(trainingCoverage)}, target ≥${pct(TRAINING_THRESHOLD)}).`,
              }),
    },
    {
      key: "MFA",
      label: "MFA enrolled for ≥80% workforce",
      max: 25,
      ...(workforceTotal === 0
        ? {
            earned: 0,
            status: "NOT_STARTED" as const,
            detail: "Add staff to begin tracking MFA enrollment.",
          }
        : mfaCoverage >= MFA_THRESHOLD
          ? {
              earned: 25,
              status: "PASS" as const,
              detail: `${workforceWithMfa}/${workforceTotal} staff enrolled (${pct(mfaCoverage)}).`,
            }
          : {
              earned: 0,
              status: "FAIL" as const,
              detail: `${workforceWithMfa}/${workforceTotal} staff enrolled (${pct(mfaCoverage)}, target ≥${pct(MFA_THRESHOLD)}).`,
            }),
    },
    {
      key: "PHISHING",
      label: "Phishing drill within 6 months, click rate <10%",
      max: 25,
      ...(phishingDrillCount === 0
        ? {
            earned: 0,
            status: "NOT_STARTED" as const,
            detail: "No drills logged yet. Most cyber insurance carriers expect this.",
          }
        : recentDrill === null
          ? {
              earned: 0,
              status: "FAIL" as const,
              detail: "Last drill was more than 6 months ago.",
            }
          : (() => {
              const clickRate =
                recentDrill.totalRecipients > 0
                  ? recentDrill.clickedCount / recentDrill.totalRecipients
                  : 0;
              if (clickRate <= PHISHING_CLICK_RATE_TARGET) {
                return {
                  earned: 25,
                  status: "PASS" as const,
                  detail: `Most recent drill ${recentDrill.conductedAt.toISOString().slice(0, 10)} — click rate ${pct(clickRate)} (target ≤${pct(PHISHING_CLICK_RATE_TARGET)}).`,
                };
              }
              return {
                earned: 12,
                status: "FAIL" as const,
                detail: `Most recent drill ${recentDrill.conductedAt.toISOString().slice(0, 10)} — click rate ${pct(clickRate)} above target ${pct(PHISHING_CLICK_RATE_TARGET)}. (Half credit for running the drill.)`,
              };
            })()),
    },
    {
      key: "BACKUP",
      label: "Backup restore-test verified within 90 days",
      max: 15,
      ...(backupVerificationCount === 0
        ? {
            earned: 0,
            status: "NOT_STARTED" as const,
            detail: "No backup verifications logged. Untested backups are not backups.",
          }
        : recentBackup
          ? {
              earned: 15,
              status: "PASS" as const,
              detail: `Last successful test ${recentBackup.verifiedAt.toISOString().slice(0, 10)} — scope: ${recentBackup.scope}.`,
            }
          : {
              earned: 0,
              status: "FAIL" as const,
              detail: "No successful verification in the last 90 days.",
            }),
    },
    {
      key: "ENCRYPTION",
      label: "≥1 PHI tech asset encrypted",
      max: 10,
      ...(totalPhiAssetCount === 0
        ? {
            earned: 0,
            status: "NOT_STARTED" as const,
            detail: "No PHI-processing assets on file. Add at /programs/security-assets.",
          }
        : encryptedPhiAssetCount >= 1
          ? {
              earned: 10,
              status: "PASS" as const,
              detail: `${encryptedPhiAssetCount}/${totalPhiAssetCount} PHI asset(s) encrypted.`,
            }
          : {
              earned: 0,
              status: "FAIL" as const,
              detail: `${encryptedPhiAssetCount}/${totalPhiAssetCount} PHI asset(s) encrypted — none currently meet the bar.`,
            }),
    },
  ];

  const total = components.reduce((acc, c) => acc + c.earned, 0);

  return {
    total,
    components,
    workforceTotal,
    workforceWithMfa,
    phishingDrillCount,
    recentPhishingDrill: recentDrill
      ? {
          conductedAt: recentDrill.conductedAt,
          clickRate:
            recentDrill.totalRecipients > 0
              ? recentDrill.clickedCount / recentDrill.totalRecipients
              : 0,
          reportRate:
            recentDrill.totalRecipients > 0
              ? recentDrill.reportedCount / recentDrill.totalRecipients
              : 0,
          vendor: recentDrill.vendor,
        }
      : null,
    backupVerificationCount,
    recentBackupVerification: recentBackup,
    encryptedPhiAssetCount,
    totalPhiAssetCount,
    cyberCoursesByUserCovered,
  };
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
