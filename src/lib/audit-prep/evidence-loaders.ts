// src/lib/audit-prep/evidence-loaders.ts
//
// Pure async loaders that snapshot live compliance evidence into
// structured objects. Called when a step is marked complete. The output
// is persisted in AuditPrepStep.evidenceJson so the PDF stays stable
// even if underlying tables change later.

import type { Prisma } from "@prisma/client";
import { formatPracticeDate } from "@/lib/audit/format";

export interface EvidenceSnapshotBase {
  capturedAt: string;
}

export interface NppEvidence extends EvidenceSnapshotBase {
  policyAdopted: boolean;
  adoptedAt: string | null;
  lastReviewedAt: string | null;
  versionNumber: number | null;
}

export interface WorkforceTrainingEvidence extends EvidenceSnapshotBase {
  totalActiveStaff: number;
  trainedStaff: number;
  coveragePct: number;
  expiringWithin60Days: number;
}

export interface RiskAnalysisEvidence extends EvidenceSnapshotBase {
  latestSraCompletedAt: string | null;
  latestSraScore: number | null;
  isFresh: boolean;
  phiAssetCount: number;
}

export interface RiskManagementEvidence extends EvidenceSnapshotBase {
  unresolvedBreachCount: number;
  openIncidentCount: number;
  resolvedBreachCount: number;
}

export interface SanctionsPolicyEvidence extends EvidenceSnapshotBase {
  privacyOfficerDesignated: boolean;
  oigFrameworkEnabled: boolean;
  oigComplianceCurrentPct: number | null;
}

export interface ContingencyPlanEvidence extends EvidenceSnapshotBase {
  breachResponsePolicyAdopted: boolean;
  totalAssetsTracked: number;
  phiAssetsWithEncryption: number;
}

// ────────────────────────────────────────────────────────────────────────
// OSHA-mode evidence (added 2026-04-24)
// ────────────────────────────────────────────────────────────────────────

export interface OshaBbpPlanEvidence extends EvidenceSnapshotBase {
  policyAdopted: boolean;
  adoptedAt: string | null;
  lastReviewedAt: string | null;
  bbpTrainingCoveragePct: number;
  totalActiveStaff: number;
}

export interface OshaHazcomEvidence extends EvidenceSnapshotBase {
  policyAdopted: boolean;
  adoptedAt: string | null;
  hazcomTrainingCoveragePct: number;
  totalActiveStaff: number;
}

export interface Osha300LogEvidence extends EvidenceSnapshotBase {
  recordableIncidentsLast12Months: number;
  recordableIncidentsAllTime: number;
  mostRecentRecordableAt: string | null;
}

export interface OshaPpeEvidence extends EvidenceSnapshotBase {
  ppeTrainingCoveragePct: number;
  bbpTrainingCoveragePct: number;
  totalActiveStaff: number;
}

export interface OshaEapEvidence extends EvidenceSnapshotBase {
  policyAdopted: boolean;
  adoptedAt: string | null;
  fireSafetyTrainingCoveragePct: number;
  totalActiveStaff: number;
}

export interface OshaNeedlestickEvidence extends EvidenceSnapshotBase {
  recentSharpsIncidents12Months: number;
  mostRecentSharpsIncidentAt: string | null;
  needlestickTrainingCoveragePct: number;
  totalActiveStaff: number;
}

// ────────────────────────────────────────────────────────────────────────
// CMS-mode evidence (added 2026-04-24 evening)
// ────────────────────────────────────────────────────────────────────────

interface CredentialOnFile {
  present: boolean;
  expiryIso: string | null;
  isCurrent: boolean;
}

export interface CmsEnrollmentEvidence extends EvidenceSnapshotBase {
  npi: CredentialOnFile;
  pecos: CredentialOnFile;
  medicareProvider: CredentialOnFile;
}

export interface CmsEpProgramEvidence extends EvidenceSnapshotBase {
  policyAdopted: boolean;
  adoptedAt: string | null;
  lastReviewedAt: string | null;
  emergencyTrainingCoveragePct: number;
  totalActiveStaff: number;
}

export interface CmsBillingEvidence extends EvidenceSnapshotBase {
  complianceOfficerDesignated: boolean;
  oigFrameworkEnabled: boolean;
  oigComplianceCurrentPct: number | null;
}

export interface CmsOverpaymentEvidence extends EvidenceSnapshotBase {
  policyAdopted: boolean;
  adoptedAt: string | null;
  lastReviewedAt: string | null;
}

export interface CmsRecordsEvidence extends EvidenceSnapshotBase {
  destructionCadenceCurrent: boolean;
  destructionCountLast365Days: number;
  retentionPolicyAdopted: boolean;
}

export interface CmsOigScreeningEvidence extends EvidenceSnapshotBase {
  oigFrameworkEnabled: boolean;
  totalActiveStaff: number;
  complianceOfficerDesignated: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// DEA-mode evidence (added 2026-04-24 evening)
// ────────────────────────────────────────────────────────────────────────

export interface DeaRegistrationEvidence extends EvidenceSnapshotBase {
  registration: CredentialOnFile;
  mostRecentRenewalAt: string | null;
}

export interface DeaInventoryEvidence extends EvidenceSnapshotBase {
  inventoryPolicyAdopted: boolean;
  inventoryPolicyAdoptedAt: string | null;
  recentControlledSubstanceIncidents12Months: number;
}

export interface DeaSecurityEvidence extends EvidenceSnapshotBase {
  securityOfficerDesignated: boolean;
  workstationPolicyAdopted: boolean;
  trackedAssetCount: number;
}

export interface DeaPdmpEvidence extends EvidenceSnapshotBase {
  pdmpPolicyAdopted: boolean;
  statePdmpPolicyAdopted: boolean;
  practicePrimaryState: string;
}

export interface DeaPrescriptionsEvidence extends EvidenceSnapshotBase {
  destructionCadenceCurrent: boolean;
  destructionCountLast365Days: number;
  mfaCoveragePct: number;
  totalActiveStaff: number;
}

export interface DeaTheftLossEvidence extends EvidenceSnapshotBase {
  deaIncidentCount: number;
  mostRecentDeaIncidentAt: string | null;
  privacyOfficerDesignated: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// ALLERGY-mode evidence (added 2026-04-30, audit #21 IM-3)
// State pharmacy board inspections of allergen-extract compounding
// (USP 797 §21).
// ────────────────────────────────────────────────────────────────────────

/// One compounder + their per-year qualification status across the
/// 3-year audit window. `isFormerStaff` is true when PracticeUser.removedAt
/// is non-null — the row still appears so the audit trail covers years
/// the compounder was active.
export interface AllergyCompounderQualificationRow {
  practiceUserId: string;
  displayName: string;
  isFormerStaff: boolean;
  yearStatuses: Array<{
    year: number;
    quizPassed: boolean;
    fingertipPassCount: number;
    mediaFillPassed: boolean;
    isFullyQualified: boolean;
  }>;
}

export interface AllergyCompounderQualificationEvidence
  extends EvidenceSnapshotBase {
  yearWindow: number[]; // [currentYear, currentYear-1, currentYear-2]
  activeCompounderCount: number;
  formerCompounderInWindowCount: number;
  rows: AllergyCompounderQualificationRow[];
}

export interface AllergyDrillRow {
  drillId: string;
  conductedAtIso: string;
  conductedAtDisplay: string; // YYYY-MM-DD in practice tz
  scenario: string;
  conductedByDisplay: string;
  participantDisplays: string[]; // resolved names; "(removed user)" preserved
  durationMinutes: number | null;
  hasCorrectiveAction: boolean;
}

export interface AllergyDrillLogEvidence extends EvidenceSnapshotBase {
  drillsLast12Months: number;
  mostRecentDrillIso: string | null;
  rows: AllergyDrillRow[]; // newest-first
}

export interface AllergyKitCheckRow {
  checkId: string;
  checkedAtIso: string;
  checkedAtDisplay: string;
  checkedByDisplay: string;
  epiExpiryIso: string | null;
  epiLotNumber: string | null;
  allItemsPresent: boolean | null;
  itemsReplaced: string | null;
}

export interface AllergyFridgeCheckRow {
  checkId: string;
  checkedAtIso: string;
  checkedAtDisplay: string;
  checkedByDisplay: string;
  temperatureC: number | null;
  inRange: boolean | null;
}

export interface AllergyEquipmentLogEvidence extends EvidenceSnapshotBase {
  kitChecksLast12Months: number;
  fridgeChecksLast12Months: number;
  mostRecentKitCheckIso: string | null;
  mostRecentFridgeCheckIso: string | null;
  kitRows: AllergyKitCheckRow[]; // newest-first
  fridgeRows: AllergyFridgeCheckRow[]; // newest-first
}

export interface AllergyQuizAttemptRow {
  attemptId: string;
  practiceUserId: string;
  takenByDisplay: string;
  isFormerStaff: boolean;
  completedAtIso: string | null;
  completedAtDisplay: string | null;
  score: number | null;
  passed: boolean | null;
  // Privacy invariant (audit #1, PR #197): we expose totalQuestions +
  // correctAnswers as scalars only. We never include answer-key data
  // (correctId / explanation / per-question selectedId) in this snapshot.
  totalQuestions: number;
  correctAnswers: number;
}

export interface AllergyQuizAttemptsEvidence extends EvidenceSnapshotBase {
  attemptsLast24Months: number;
  passedCount: number;
  passRatePct: number;
  averageScore: number | null;
  rows: AllergyQuizAttemptRow[]; // newest-first
}

export interface AllergyDeviationsEvidence extends EvidenceSnapshotBase {
  taggedIncidentsLast24Months: number;
  mostRecentTaggedIncidentIso: string | null;
  openIncidents: number;
  resolvedIncidents: number;
  drillsWithCorrectiveActionsLast24Months: number;
}

export type EvidenceSnapshot =
  | NppEvidence
  | WorkforceTrainingEvidence
  | RiskAnalysisEvidence
  | RiskManagementEvidence
  | SanctionsPolicyEvidence
  | ContingencyPlanEvidence
  | OshaBbpPlanEvidence
  | OshaHazcomEvidence
  | Osha300LogEvidence
  | OshaPpeEvidence
  | OshaEapEvidence
  | OshaNeedlestickEvidence
  | CmsEnrollmentEvidence
  | CmsEpProgramEvidence
  | CmsBillingEvidence
  | CmsOverpaymentEvidence
  | CmsRecordsEvidence
  | CmsOigScreeningEvidence
  | DeaRegistrationEvidence
  | DeaInventoryEvidence
  | DeaSecurityEvidence
  | DeaPdmpEvidence
  | DeaPrescriptionsEvidence
  | DeaTheftLossEvidence
  | AllergyCompounderQualificationEvidence
  | AllergyDrillLogEvidence
  | AllergyEquipmentLogEvidence
  | AllergyQuizAttemptsEvidence
  | AllergyDeviationsEvidence;

const DAY_MS = 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * DAY_MS;

export async function loadNppEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<NppEvidence> {
  const policy = await tx.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId,
        policyCode: "HIPAA_NPP_POLICY",
      },
    },
    select: {
      adoptedAt: true,
      lastReviewedAt: true,
      version: true,
      retiredAt: true,
    },
  });
  return {
    capturedAt: new Date().toISOString(),
    policyAdopted: !!policy && policy.retiredAt === null,
    adoptedAt: policy?.adoptedAt?.toISOString() ?? null,
    lastReviewedAt: policy?.lastReviewedAt?.toISOString() ?? null,
    versionNumber: policy?.version ?? null,
  };
}

export async function loadWorkforceTrainingEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<WorkforceTrainingEvidence> {
  const totalActiveStaff = await tx.practiceUser.count({
    where: { practiceId, removedAt: null },
  });
  const completions = await tx.trainingCompletion.findMany({
    where: { practiceId, passed: true },
    select: {
      userId: true,
      expiresAt: true,
      course: { select: { code: true } },
    },
  });
  const hipaaBasicsCompletions = completions.filter(
    (c) => c.course.code === "HIPAA_BASICS",
  );
  const trainedStaff = new Set(hipaaBasicsCompletions.map((c) => c.userId)).size;
  const coveragePct =
    totalActiveStaff === 0
      ? 0
      : Math.round((trainedStaff / totalActiveStaff) * 100);
  const horizon = new Date(Date.now() + SIXTY_DAYS_MS);
  const expiringWithin60Days = completions.filter(
    (c) => c.expiresAt < horizon,
  ).length;
  return {
    capturedAt: new Date().toISOString(),
    totalActiveStaff,
    trainedStaff,
    coveragePct,
    expiringWithin60Days,
  };
}

export async function loadRiskAnalysisEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<RiskAnalysisEvidence> {
  const latestSra = await tx.practiceSraAssessment.findFirst({
    where: { practiceId, isDraft: false, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true, overallScore: true },
  });
  const phiAssetCount = await tx.techAsset.count({
    where: { practiceId, processesPhi: true, retiredAt: null },
  });
  const isFresh =
    latestSra?.completedAt !== null &&
    latestSra?.completedAt !== undefined &&
    Date.now() - latestSra.completedAt.getTime() < 365 * DAY_MS;
  return {
    capturedAt: new Date().toISOString(),
    latestSraCompletedAt: latestSra?.completedAt?.toISOString() ?? null,
    latestSraScore: latestSra?.overallScore ?? null,
    isFresh,
    phiAssetCount,
  };
}

export async function loadRiskManagementEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<RiskManagementEvidence> {
  const [unresolvedBreachCount, openIncidentCount, resolvedBreachCount] =
    await Promise.all([
      tx.incident.count({
        where: { practiceId, isBreach: true, resolvedAt: null },
      }),
      tx.incident.count({
        where: {
          practiceId,
          status: { in: ["OPEN", "UNDER_INVESTIGATION"] },
        },
      }),
      tx.incident.count({
        where: { practiceId, isBreach: true, resolvedAt: { not: null } },
      }),
    ]);
  return {
    capturedAt: new Date().toISOString(),
    unresolvedBreachCount,
    openIncidentCount,
    resolvedBreachCount,
  };
}

export async function loadSanctionsPolicyEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<SanctionsPolicyEvidence> {
  const privacyOfficer = await tx.practiceUser.findFirst({
    where: { practiceId, isPrivacyOfficer: true, removedAt: null },
    select: { id: true },
  });
  const oigFw = await tx.regulatoryFramework.findUnique({
    where: { code: "OIG" },
    select: { id: true },
  });
  let oigEnabled = false;
  let oigScore: number | null = null;
  if (oigFw) {
    const pf = await tx.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: { practiceId, frameworkId: oigFw.id },
      },
      select: { enabled: true, scoreCache: true },
    });
    oigEnabled = pf?.enabled ?? false;
    oigScore = pf?.scoreCache ?? null;
  }
  return {
    capturedAt: new Date().toISOString(),
    privacyOfficerDesignated: !!privacyOfficer,
    oigFrameworkEnabled: oigEnabled,
    oigComplianceCurrentPct: oigScore,
  };
}

export async function loadContingencyPlanEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<ContingencyPlanEvidence> {
  const policy = await tx.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId,
        policyCode: "HIPAA_BREACH_RESPONSE_POLICY",
      },
    },
    select: { retiredAt: true },
  });
  const totalAssetsTracked = await tx.techAsset.count({
    where: { practiceId, retiredAt: null },
  });
  const phiAssetsWithEncryption = await tx.techAsset.count({
    where: {
      practiceId,
      retiredAt: null,
      processesPhi: true,
      encryption: { in: ["FULL_DISK", "FIELD_LEVEL"] },
    },
  });
  return {
    capturedAt: new Date().toISOString(),
    breachResponsePolicyAdopted: !!policy && policy.retiredAt === null,
    totalAssetsTracked,
    phiAssetsWithEncryption,
  };
}

// ────────────────────────────────────────────────────────────────────────
// OSHA loaders
// ────────────────────────────────────────────────────────────────────────

const TWELVE_MONTHS_MS = 365 * DAY_MS;

/** Helper: returns workforce training coverage % for a single course code. */
async function courseCoveragePct(
  tx: Prisma.TransactionClient,
  practiceId: string,
  courseCode: string,
): Promise<{ coveragePct: number; total: number }> {
  const total = await tx.practiceUser.count({
    where: { practiceId, removedAt: null },
  });
  if (total === 0) return { coveragePct: 0, total: 0 };
  const course = await tx.trainingCourse.findUnique({
    where: { code: courseCode },
    select: { id: true },
  });
  if (!course) return { coveragePct: 0, total };
  const completions = await tx.trainingCompletion.findMany({
    where: {
      practiceId,
      courseId: course.id,
      passed: true,
      expiresAt: { gt: new Date() },
    },
    distinct: ["userId"],
    select: { userId: true },
  });
  const trained = completions.length;
  return { coveragePct: Math.round((trained / total) * 100), total };
}

export async function loadOshaBbpPlanEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<OshaBbpPlanEvidence> {
  const policy = await tx.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId,
        policyCode: "OSHA_BBP_EXPOSURE_CONTROL_PLAN",
      },
    },
    select: { adoptedAt: true, lastReviewedAt: true, retiredAt: true },
  });
  const { coveragePct, total } = await courseCoveragePct(
    tx,
    practiceId,
    "BLOODBORNE_PATHOGEN_TRAINING",
  );
  return {
    capturedAt: new Date().toISOString(),
    policyAdopted: !!policy && policy.retiredAt === null,
    adoptedAt: policy?.adoptedAt?.toISOString() ?? null,
    lastReviewedAt: policy?.lastReviewedAt?.toISOString() ?? null,
    bbpTrainingCoveragePct: coveragePct,
    totalActiveStaff: total,
  };
}

export async function loadOshaHazcomEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<OshaHazcomEvidence> {
  const policy = await tx.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId,
        policyCode: "OSHA_HAZCOM_PROGRAM",
      },
    },
    select: { adoptedAt: true, retiredAt: true },
  });
  const { coveragePct, total } = await courseCoveragePct(
    tx,
    practiceId,
    "HAZCOM_TRAINING",
  );
  return {
    capturedAt: new Date().toISOString(),
    policyAdopted: !!policy && policy.retiredAt === null,
    adoptedAt: policy?.adoptedAt?.toISOString() ?? null,
    hazcomTrainingCoveragePct: coveragePct,
    totalActiveStaff: total,
  };
}

export async function loadOsha300LogEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<Osha300LogEvidence> {
  const cutoff = new Date(Date.now() - TWELVE_MONTHS_MS);
  // §1904.7(b)(5): first-aid-only injuries are NOT recordable on Form
  // 300, so all three counts here exclude them. Same exclusion applies
  // in osha300LogRule + the /api/audit/osha-300 route.
  const notFirstAid = { not: "FIRST_AID" } as const;
  const [recent12, allTime, mostRecent] = await Promise.all([
    tx.incident.count({
      where: {
        practiceId,
        type: "OSHA_RECORDABLE",
        discoveredAt: { gte: cutoff },
        oshaOutcome: notFirstAid,
      },
    }),
    tx.incident.count({
      where: {
        practiceId,
        type: "OSHA_RECORDABLE",
        oshaOutcome: notFirstAid,
      },
    }),
    tx.incident.findFirst({
      where: {
        practiceId,
        type: "OSHA_RECORDABLE",
        oshaOutcome: notFirstAid,
      },
      orderBy: { discoveredAt: "desc" },
      select: { discoveredAt: true },
    }),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    recordableIncidentsLast12Months: recent12,
    recordableIncidentsAllTime: allTime,
    mostRecentRecordableAt: mostRecent?.discoveredAt.toISOString() ?? null,
  };
}

export async function loadOshaPpeEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<OshaPpeEvidence> {
  const ppe = await courseCoveragePct(tx, practiceId, "PPE_SELECTION_USE");
  const bbp = await courseCoveragePct(
    tx,
    practiceId,
    "BLOODBORNE_PATHOGEN_TRAINING",
  );
  return {
    capturedAt: new Date().toISOString(),
    ppeTrainingCoveragePct: ppe.coveragePct,
    bbpTrainingCoveragePct: bbp.coveragePct,
    totalActiveStaff: ppe.total,
  };
}

export async function loadOshaEapEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<OshaEapEvidence> {
  const policy = await tx.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId,
        policyCode: "OSHA_EMERGENCY_ACTION_PLAN",
      },
    },
    select: { adoptedAt: true, retiredAt: true },
  });
  const { coveragePct, total } = await courseCoveragePct(
    tx,
    practiceId,
    "FIRE_SAFETY_EVACUATION",
  );
  return {
    capturedAt: new Date().toISOString(),
    policyAdopted: !!policy && policy.retiredAt === null,
    adoptedAt: policy?.adoptedAt?.toISOString() ?? null,
    fireSafetyTrainingCoveragePct: coveragePct,
    totalActiveStaff: total,
  };
}

export async function loadOshaNeedlestickEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<OshaNeedlestickEvidence> {
  const cutoff = new Date(Date.now() - TWELVE_MONTHS_MS);
  // Sharps log = OSHA_RECORDABLE incidents whose title or description
  // mentions sharps/needlestick. Imperfect (no dedicated tag in MVP)
  // but transparent — the audit packet shows the count and the user
  // can correct in notes if categorization is off.
  const recentRows = await tx.incident.findMany({
    where: {
      practiceId,
      type: "OSHA_RECORDABLE",
      discoveredAt: { gte: cutoff },
      OR: [
        { title: { contains: "needlestick", mode: "insensitive" } },
        { title: { contains: "sharps", mode: "insensitive" } },
        { description: { contains: "needlestick", mode: "insensitive" } },
        { description: { contains: "sharps", mode: "insensitive" } },
      ],
    },
    orderBy: { discoveredAt: "desc" },
    select: { discoveredAt: true },
  });
  const { coveragePct, total } = await courseCoveragePct(
    tx,
    practiceId,
    "NEEDLESTICK_SHARPS_SAFETY",
  );
  return {
    capturedAt: new Date().toISOString(),
    recentSharpsIncidents12Months: recentRows.length,
    mostRecentSharpsIncidentAt: recentRows[0]?.discoveredAt.toISOString() ?? null,
    needlestickTrainingCoveragePct: coveragePct,
    totalActiveStaff: total,
  };
}

// ────────────────────────────────────────────────────────────────────────
// CMS-mode loaders (added 2026-04-24 evening)
// ────────────────────────────────────────────────────────────────────────

/** Helper: returns whether ≥1 active+non-expired credential of the given
 * code exists for the practice. */
async function credentialOnFile(
  tx: Prisma.TransactionClient,
  practiceId: string,
  credentialTypeCode: string,
): Promise<CredentialOnFile> {
  const credType = await tx.credentialType.findUnique({
    where: { code: credentialTypeCode },
    select: { id: true },
  });
  if (!credType) {
    return { present: false, expiryIso: null, isCurrent: false };
  }
  const cred = await tx.credential.findFirst({
    where: { practiceId, credentialTypeId: credType.id, retiredAt: null },
    orderBy: { expiryDate: "desc" },
    select: { expiryDate: true },
  });
  if (!cred) {
    return { present: false, expiryIso: null, isCurrent: false };
  }
  const now = new Date();
  const isCurrent =
    cred.expiryDate === null || cred.expiryDate > now; // null = perpetual
  return {
    present: true,
    expiryIso: cred.expiryDate?.toISOString() ?? null,
    isCurrent,
  };
}

export async function loadCmsEnrollmentEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<CmsEnrollmentEvidence> {
  const [npi, pecos, medicareProvider] = await Promise.all([
    credentialOnFile(tx, practiceId, "NPI_REGISTRATION"),
    credentialOnFile(tx, practiceId, "MEDICARE_PECOS_ENROLLMENT"),
    credentialOnFile(tx, practiceId, "MEDICARE_PROVIDER_ENROLLMENT"),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    npi,
    pecos,
    medicareProvider,
  };
}

export async function loadCmsEpProgramEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<CmsEpProgramEvidence> {
  const policy = await tx.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId,
        policyCode: "OSHA_EMERGENCY_ACTION_PLAN",
      },
    },
    select: { adoptedAt: true, lastReviewedAt: true, retiredAt: true },
  });
  const { coveragePct, total } = await courseCoveragePct(
    tx,
    practiceId,
    "EMERGENCY_PREPAREDNESS",
  );
  return {
    capturedAt: new Date().toISOString(),
    policyAdopted: !!policy && policy.retiredAt === null,
    adoptedAt: policy?.adoptedAt?.toISOString() ?? null,
    lastReviewedAt: policy?.lastReviewedAt?.toISOString() ?? null,
    emergencyTrainingCoveragePct: coveragePct,
    totalActiveStaff: total,
  };
}

export async function loadCmsBillingEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<CmsBillingEvidence> {
  const complianceOfficer = await tx.practiceUser.findFirst({
    where: { practiceId, isComplianceOfficer: true, removedAt: null },
    select: { id: true },
  });
  const oigFw = await tx.regulatoryFramework.findUnique({
    where: { code: "OIG" },
    select: { id: true },
  });
  let oigEnabled = false;
  let oigScore: number | null = null;
  if (oigFw) {
    const pf = await tx.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: { practiceId, frameworkId: oigFw.id },
      },
      select: { enabled: true, scoreCache: true },
    });
    oigEnabled = pf?.enabled ?? false;
    oigScore = pf?.scoreCache ?? null;
  }
  return {
    capturedAt: new Date().toISOString(),
    complianceOfficerDesignated: !!complianceOfficer,
    oigFrameworkEnabled: oigEnabled,
    oigComplianceCurrentPct: oigScore,
  };
}

export async function loadCmsOverpaymentEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<CmsOverpaymentEvidence> {
  // The policy-template catalog (PR #112) ships an overpayment refund
  // policy as part of the GENERAL framework templates, but the v2
  // canonical core set doesn't include it. Look up by either code.
  const policy = await tx.practicePolicy.findFirst({
    where: {
      practiceId,
      retiredAt: null,
      OR: [
        { policyCode: { contains: "OVERPAYMENT" } },
        { policyCode: { contains: "BILLING_COMPLIANCE" } },
      ],
    },
    select: { adoptedAt: true, lastReviewedAt: true },
  });
  return {
    capturedAt: new Date().toISOString(),
    policyAdopted: !!policy,
    adoptedAt: policy?.adoptedAt?.toISOString() ?? null,
    lastReviewedAt: policy?.lastReviewedAt?.toISOString() ?? null,
  };
}

export async function loadCmsRecordsEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<CmsRecordsEvidence> {
  const cutoff = new Date(Date.now() - 365 * DAY_MS);
  const destructionCount = await tx.destructionLog.count({
    where: { practiceId, destroyedAt: { gte: cutoff } },
  });
  const policy = await tx.practicePolicy.findFirst({
    where: {
      practiceId,
      retiredAt: null,
      policyCode: { contains: "RECORDS_RETENTION" },
    },
    select: { id: true },
  });
  return {
    capturedAt: new Date().toISOString(),
    destructionCadenceCurrent: destructionCount > 0,
    destructionCountLast365Days: destructionCount,
    retentionPolicyAdopted: !!policy,
  };
}

export async function loadCmsOigScreeningEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<CmsOigScreeningEvidence> {
  const totalActiveStaff = await tx.practiceUser.count({
    where: { practiceId, removedAt: null },
  });
  const complianceOfficer = await tx.practiceUser.findFirst({
    where: { practiceId, isComplianceOfficer: true, removedAt: null },
    select: { id: true },
  });
  const oigFw = await tx.regulatoryFramework.findUnique({
    where: { code: "OIG" },
    select: { id: true },
  });
  let oigEnabled = false;
  if (oigFw) {
    const pf = await tx.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: { practiceId, frameworkId: oigFw.id },
      },
      select: { enabled: true },
    });
    oigEnabled = pf?.enabled ?? false;
  }
  return {
    capturedAt: new Date().toISOString(),
    oigFrameworkEnabled: oigEnabled,
    totalActiveStaff,
    complianceOfficerDesignated: !!complianceOfficer,
  };
}

// ────────────────────────────────────────────────────────────────────────
// DEA-mode loaders (added 2026-04-24 evening)
// ────────────────────────────────────────────────────────────────────────

export async function loadDeaRegistrationEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeaRegistrationEvidence> {
  const registration = await credentialOnFile(
    tx,
    practiceId,
    "DEA_CONTROLLED_SUBSTANCE_REGISTRATION",
  );
  // Most-recent renewal proxy: the credential's most recent createdAt
  // (we don't track issued-at separately for credentials in v2 yet).
  const credType = await tx.credentialType.findUnique({
    where: { code: "DEA_CONTROLLED_SUBSTANCE_REGISTRATION" },
    select: { id: true },
  });
  let mostRecentRenewalAt: string | null = null;
  if (credType) {
    const cred = await tx.credential.findFirst({
      where: { practiceId, credentialTypeId: credType.id, retiredAt: null },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    mostRecentRenewalAt = cred?.updatedAt?.toISOString() ?? null;
  }
  return {
    capturedAt: new Date().toISOString(),
    registration,
    mostRecentRenewalAt,
  };
}

export async function loadDeaInventoryEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeaInventoryEvidence> {
  const policy = await tx.practicePolicy.findFirst({
    where: {
      practiceId,
      retiredAt: null,
      OR: [
        { policyCode: { contains: "PDMP" } },
        { policyCode: { contains: "CONTROLLED" } },
        { policyCode: { contains: "DEA" } },
      ],
    },
    select: { adoptedAt: true },
  });
  const cutoff = new Date(Date.now() - 365 * DAY_MS);
  const recentCount = await tx.incident.count({
    where: {
      practiceId,
      type: "DEA_THEFT_LOSS",
      discoveredAt: { gte: cutoff },
    },
  });
  return {
    capturedAt: new Date().toISOString(),
    inventoryPolicyAdopted: !!policy,
    inventoryPolicyAdoptedAt: policy?.adoptedAt?.toISOString() ?? null,
    recentControlledSubstanceIncidents12Months: recentCount,
  };
}

export async function loadDeaSecurityEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeaSecurityEvidence> {
  const securityOfficer = await tx.practiceUser.findFirst({
    where: { practiceId, isSecurityOfficer: true, removedAt: null },
    select: { id: true },
  });
  const workstationPolicy = await tx.practicePolicy.findUnique({
    where: {
      practiceId_policyCode: {
        practiceId,
        policyCode: "HIPAA_WORKSTATION_POLICY",
      },
    },
    select: { retiredAt: true },
  });
  const trackedAssetCount = await tx.techAsset.count({
    where: { practiceId, retiredAt: null },
  });
  return {
    capturedAt: new Date().toISOString(),
    securityOfficerDesignated: !!securityOfficer,
    workstationPolicyAdopted:
      !!workstationPolicy && workstationPolicy.retiredAt === null,
    trackedAssetCount,
  };
}

export async function loadDeaPdmpEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeaPdmpEvidence> {
  const practice = await tx.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { primaryState: true },
  });
  const pdmp = await tx.practicePolicy.findFirst({
    where: {
      practiceId,
      retiredAt: null,
      policyCode: { contains: "PDMP" },
    },
    select: { id: true },
  });
  const statePdmp = await tx.practicePolicy.findFirst({
    where: {
      practiceId,
      retiredAt: null,
      policyCode: { contains: "STATE_PDMP" },
    },
    select: { id: true },
  });
  return {
    capturedAt: new Date().toISOString(),
    pdmpPolicyAdopted: !!pdmp,
    statePdmpPolicyAdopted: !!statePdmp,
    practicePrimaryState: practice.primaryState,
  };
}

export async function loadDeaPrescriptionsEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeaPrescriptionsEvidence> {
  const cutoff = new Date(Date.now() - 365 * DAY_MS);
  const destructionCount = await tx.destructionLog.count({
    where: { practiceId, destroyedAt: { gte: cutoff } },
  });
  const totalActiveStaff = await tx.practiceUser.count({
    where: { practiceId, removedAt: null },
  });
  const enrolled = await tx.practiceUser.count({
    where: { practiceId, removedAt: null, mfaEnrolledAt: { not: null } },
  });
  const mfaCoveragePct =
    totalActiveStaff === 0
      ? 0
      : Math.round((enrolled / totalActiveStaff) * 100);
  return {
    capturedAt: new Date().toISOString(),
    destructionCadenceCurrent: destructionCount > 0,
    destructionCountLast365Days: destructionCount,
    mfaCoveragePct,
    totalActiveStaff,
  };
}

export async function loadDeaTheftLossEvidence(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DeaTheftLossEvidence> {
  const deaIncidents = await tx.incident.findMany({
    where: { practiceId, type: "DEA_THEFT_LOSS" },
    orderBy: { discoveredAt: "desc" },
    select: { discoveredAt: true },
  });
  const privacyOfficer = await tx.practiceUser.findFirst({
    where: { practiceId, isPrivacyOfficer: true, removedAt: null },
    select: { id: true },
  });
  return {
    capturedAt: new Date().toISOString(),
    deaIncidentCount: deaIncidents.length,
    mostRecentDeaIncidentAt: deaIncidents[0]?.discoveredAt.toISOString() ?? null,
    privacyOfficerDesignated: !!privacyOfficer,
  };
}

// ────────────────────────────────────────────────────────────────────────
// ALLERGY-mode loaders (added 2026-04-30, audit #21 IM-3)
// State pharmacy board inspections of allergen-extract compounding
// (USP 797 §21).
// ────────────────────────────────────────────────────────────────────────

const TWENTY_FOUR_MONTHS_MS = 2 * 365 * DAY_MS;

/// Resolve many PracticeUser display names in a single roundtrip.
/// Returns a "{name} (removed)" suffix when removedAt is non-null so the
/// audit trail flags former staff without losing the historical record.
/// Order of the returned Map is not meaningful — callers index by id.
async function resolveDisplayNames(
  tx: Prisma.TransactionClient,
  practiceId: string,
  practiceUserIds: string[],
): Promise<Map<string, { name: string; isFormerStaff: boolean }>> {
  if (practiceUserIds.length === 0) return new Map();
  const rows = await tx.practiceUser.findMany({
    where: { id: { in: practiceUserIds }, practiceId },
    select: {
      id: true,
      removedAt: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  const out = new Map<string, { name: string; isFormerStaff: boolean }>();
  for (const r of rows) {
    const base =
      [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") ||
      r.user.email ||
      "Unknown";
    out.set(r.id, {
      name: r.removedAt !== null ? `${base} (removed)` : base,
      isFormerStaff: r.removedAt !== null,
    });
  }
  return out;
}

export async function loadAllergyCompounderQualification(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<AllergyCompounderQualificationEvidence> {
  const currentYear = new Date().getUTCFullYear();
  const yearWindow = [currentYear, currentYear - 1, currentYear - 2];

  // Pull every competency row in the 3-year window, regardless of
  // whether the holder is still active. We need former staff to surface
  // for the years they were active.
  const competencies = await tx.allergyCompetency.findMany({
    where: { practiceId, year: { in: yearWindow } },
    select: {
      practiceUserId: true,
      year: true,
      quizPassedAt: true,
      fingertipPassCount: true,
      mediaFillPassedAt: true,
      isFullyQualified: true,
    },
  });

  // Active compounders today (the practice's current roster).
  const activeMembers = await tx.practiceUser.findMany({
    where: { practiceId, removedAt: null, requiresAllergyCompetency: true },
    select: {
      id: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  // Union of all PracticeUser ids referenced (active OR former with a
  // competency in the window). Resolve display names for everyone.
  const allIds = new Set<string>();
  for (const m of activeMembers) allIds.add(m.id);
  for (const c of competencies) allIds.add(c.practiceUserId);
  const nameMap = await resolveDisplayNames(tx, practiceId, [...allIds]);

  // Group competencies by practiceUserId.
  const byUser = new Map<
    string,
    Array<{ year: number; quiz: boolean; ft: number; mf: boolean; q: boolean }>
  >();
  for (const c of competencies) {
    const list = byUser.get(c.practiceUserId) ?? [];
    list.push({
      year: c.year,
      quiz: c.quizPassedAt !== null,
      ft: c.fingertipPassCount,
      mf: c.mediaFillPassedAt !== null,
      q: c.isFullyQualified,
    });
    byUser.set(c.practiceUserId, list);
  }

  const rows: AllergyCompounderQualificationRow[] = [];
  let formerCount = 0;
  for (const id of allIds) {
    const meta = nameMap.get(id) ?? { name: "(unknown)", isFormerStaff: false };
    if (meta.isFormerStaff) formerCount += 1;
    const yearRows = byUser.get(id) ?? [];
    const yearStatuses = yearWindow.map((y) => {
      const r = yearRows.find((x) => x.year === y);
      return {
        year: y,
        quizPassed: r?.quiz ?? false,
        fingertipPassCount: r?.ft ?? 0,
        mediaFillPassed: r?.mf ?? false,
        isFullyQualified: r?.q ?? false,
      };
    });
    rows.push({
      practiceUserId: id,
      displayName: meta.name,
      isFormerStaff: meta.isFormerStaff,
      yearStatuses,
    });
  }

  // Stable sort: active first, then by name.
  rows.sort((a, b) => {
    if (a.isFormerStaff !== b.isFormerStaff) {
      return a.isFormerStaff ? 1 : -1;
    }
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    capturedAt: new Date().toISOString(),
    yearWindow,
    activeCompounderCount: activeMembers.length,
    formerCompounderInWindowCount: formerCount,
    rows,
  };
}

export async function loadAllergyDrillLog(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<AllergyDrillLogEvidence> {
  const practice = await tx.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { timezone: true },
  });
  const tz = practice.timezone;
  const cutoff = new Date(Date.now() - TWELVE_MONTHS_MS);

  // Audit #15 (PR #213): retiredAt: null hides soft-deleted rows from
  // history reads. Same rule applies in the audit packet — a deleted
  // drill should not surface to a state inspector.
  const drills = await tx.allergyDrill.findMany({
    where: { practiceId, retiredAt: null },
    orderBy: { conductedAt: "desc" },
    select: {
      id: true,
      conductedAt: true,
      scenario: true,
      conductedById: true,
      participantIds: true,
      durationMinutes: true,
      correctiveActions: true,
    },
  });

  // Resolve every PracticeUser id mentioned across all drills in one
  // pass (conductors + participants).
  const idsToResolve = new Set<string>();
  for (const d of drills) {
    idsToResolve.add(d.conductedById);
    for (const pid of d.participantIds) idsToResolve.add(pid);
  }
  const nameMap = await resolveDisplayNames(tx, practiceId, [...idsToResolve]);

  const rows: AllergyDrillRow[] = drills.map((d) => {
    const conductor = nameMap.get(d.conductedById) ?? {
      name: "(unknown)",
      isFormerStaff: false,
    };
    const participantDisplays = d.participantIds.map(
      (pid) => (nameMap.get(pid) ?? { name: "(unknown)" }).name,
    );
    return {
      drillId: d.id,
      conductedAtIso: d.conductedAt.toISOString(),
      conductedAtDisplay: formatPracticeDate(d.conductedAt, tz),
      scenario: d.scenario,
      conductedByDisplay: conductor.name,
      participantDisplays,
      durationMinutes: d.durationMinutes,
      hasCorrectiveAction:
        d.correctiveActions !== null && d.correctiveActions.trim().length > 0,
    };
  });

  return {
    capturedAt: new Date().toISOString(),
    drillsLast12Months: drills.filter((d) => d.conductedAt >= cutoff).length,
    mostRecentDrillIso: drills[0]?.conductedAt.toISOString() ?? null,
    rows,
  };
}

export async function loadAllergyEquipmentLog(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<AllergyEquipmentLogEvidence> {
  const practice = await tx.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { timezone: true },
  });
  const tz = practice.timezone;
  const cutoff = new Date(Date.now() - TWELVE_MONTHS_MS);

  // Pattern mirrors PR #229 / pattern in src/app/(dashboard)/programs/
  // allergy/page.tsx: pull both kit + fridge with retiredAt: null
  // (audit #15 soft-delete) and split by checkType.
  const checks = await tx.allergyEquipmentCheck.findMany({
    where: { practiceId, retiredAt: null },
    orderBy: { checkedAt: "desc" },
    select: {
      id: true,
      checkType: true,
      checkedAt: true,
      checkedById: true,
      epiExpiryDate: true,
      epiLotNumber: true,
      allItemsPresent: true,
      itemsReplaced: true,
      temperatureC: true,
      inRange: true,
    },
  });

  const ids = new Set<string>();
  for (const c of checks) ids.add(c.checkedById);
  const nameMap = await resolveDisplayNames(tx, practiceId, [...ids]);

  const kitRows: AllergyKitCheckRow[] = [];
  const fridgeRows: AllergyFridgeCheckRow[] = [];
  let kitWindowCount = 0;
  let fridgeWindowCount = 0;
  let mostRecentKit: Date | null = null;
  let mostRecentFridge: Date | null = null;

  for (const c of checks) {
    const checkedBy = (nameMap.get(c.checkedById) ?? { name: "(unknown)" }).name;
    if (c.checkType === "EMERGENCY_KIT") {
      kitRows.push({
        checkId: c.id,
        checkedAtIso: c.checkedAt.toISOString(),
        checkedAtDisplay: formatPracticeDate(c.checkedAt, tz),
        checkedByDisplay: checkedBy,
        epiExpiryIso: c.epiExpiryDate?.toISOString() ?? null,
        epiLotNumber: c.epiLotNumber,
        allItemsPresent: c.allItemsPresent,
        itemsReplaced: c.itemsReplaced,
      });
      if (c.checkedAt >= cutoff) kitWindowCount += 1;
      if (mostRecentKit === null) mostRecentKit = c.checkedAt;
    } else if (c.checkType === "REFRIGERATOR_TEMP") {
      fridgeRows.push({
        checkId: c.id,
        checkedAtIso: c.checkedAt.toISOString(),
        checkedAtDisplay: formatPracticeDate(c.checkedAt, tz),
        checkedByDisplay: checkedBy,
        temperatureC: c.temperatureC,
        inRange: c.inRange,
      });
      if (c.checkedAt >= cutoff) fridgeWindowCount += 1;
      if (mostRecentFridge === null) mostRecentFridge = c.checkedAt;
    }
    // SKIN_TEST_SUPPLIES omitted from packet (not part of state board ask).
  }

  return {
    capturedAt: new Date().toISOString(),
    kitChecksLast12Months: kitWindowCount,
    fridgeChecksLast12Months: fridgeWindowCount,
    mostRecentKitCheckIso: mostRecentKit?.toISOString() ?? null,
    mostRecentFridgeCheckIso: mostRecentFridge?.toISOString() ?? null,
    kitRows,
    fridgeRows,
  };
}

export async function loadAllergyQuizAttempts(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<AllergyQuizAttemptsEvidence> {
  const practice = await tx.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { timezone: true },
  });
  const tz = practice.timezone;
  const cutoff = new Date(Date.now() - TWENTY_FOUR_MONTHS_MS);

  // Audit #1 invariant (PR #197): the snapshot exposes scalars only —
  // score, passed, totalQuestions, correctAnswers. We deliberately do
  // NOT include the AllergyQuizAnswer rows (selectedId / per-question
  // detail) because that table joins to AllergyQuizQuestion which holds
  // correctId + explanation. Read shape here cannot leak the answer key.
  const attempts = await tx.allergyQuizAttempt.findMany({
    where: {
      practiceId,
      completedAt: { gte: cutoff, not: null },
    },
    orderBy: { completedAt: "desc" },
    select: {
      id: true,
      practiceUserId: true,
      completedAt: true,
      score: true,
      passed: true,
      totalQuestions: true,
      correctAnswers: true,
    },
  });

  const ids = new Set<string>();
  for (const a of attempts) ids.add(a.practiceUserId);
  const nameMap = await resolveDisplayNames(tx, practiceId, [...ids]);

  const rows: AllergyQuizAttemptRow[] = attempts.map((a) => {
    const meta = nameMap.get(a.practiceUserId) ?? {
      name: "(unknown)",
      isFormerStaff: false,
    };
    return {
      attemptId: a.id,
      practiceUserId: a.practiceUserId,
      takenByDisplay: meta.name,
      isFormerStaff: meta.isFormerStaff,
      completedAtIso: a.completedAt?.toISOString() ?? null,
      completedAtDisplay: a.completedAt
        ? formatPracticeDate(a.completedAt, tz)
        : null,
      score: a.score,
      passed: a.passed,
      totalQuestions: a.totalQuestions,
      correctAnswers: a.correctAnswers,
    };
  });

  const passedCount = rows.filter((r) => r.passed === true).length;
  const passRatePct =
    rows.length === 0 ? 0 : Math.round((passedCount / rows.length) * 100);
  const scoreSum = rows.reduce((acc, r) => acc + (r.score ?? 0), 0);
  const averageScore =
    rows.length === 0 ? null : Math.round(scoreSum / rows.length);

  return {
    capturedAt: new Date().toISOString(),
    attemptsLast24Months: rows.length,
    passedCount,
    passRatePct,
    averageScore,
    rows,
  };
}

export async function loadAllergyDeviations(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<AllergyDeviationsEvidence> {
  const cutoff = new Date(Date.now() - TWENTY_FOUR_MONTHS_MS);

  // No dedicated IncidentType for USP §21 in MVP (mirrors the OSHA
  // needlestick approach in loadOshaNeedlestickEvidence): match by
  // title/description keywords. Inspectors get a transparent "here's
  // what we matched" + the user can correct via notes.
  const tagged = await tx.incident.findMany({
    where: {
      practiceId,
      discoveredAt: { gte: cutoff },
      OR: [
        { title: { contains: "USP", mode: "insensitive" } },
        { title: { contains: "compounding", mode: "insensitive" } },
        { title: { contains: "allergen", mode: "insensitive" } },
        { title: { contains: "allergy", mode: "insensitive" } },
        { description: { contains: "USP", mode: "insensitive" } },
        { description: { contains: "compounding", mode: "insensitive" } },
        { description: { contains: "allergen", mode: "insensitive" } },
        { description: { contains: "allergy", mode: "insensitive" } },
      ],
    },
    orderBy: { discoveredAt: "desc" },
    select: { discoveredAt: true, status: true },
  });

  const drillsWithCa = await tx.allergyDrill.count({
    where: {
      practiceId,
      retiredAt: null,
      conductedAt: { gte: cutoff },
      correctiveActions: { not: null },
    },
  });

  const openIncidents = tagged.filter(
    (t) => t.status === "OPEN" || t.status === "UNDER_INVESTIGATION",
  ).length;
  const resolvedIncidents = tagged.filter(
    (t) => t.status === "RESOLVED" || t.status === "CLOSED",
  ).length;

  return {
    capturedAt: new Date().toISOString(),
    taggedIncidentsLast24Months: tagged.length,
    mostRecentTaggedIncidentIso: tagged[0]?.discoveredAt.toISOString() ?? null,
    openIncidents,
    resolvedIncidents,
    drillsWithCorrectiveActionsLast24Months: drillsWithCa,
  };
}

export const EVIDENCE_LOADERS: Record<
  string,
  (
    tx: Prisma.TransactionClient,
    practiceId: string,
  ) => Promise<EvidenceSnapshot>
> = {
  NPP_DELIVERY: loadNppEvidence,
  WORKFORCE_TRAINING: loadWorkforceTrainingEvidence,
  RISK_ANALYSIS: loadRiskAnalysisEvidence,
  RISK_MANAGEMENT: loadRiskManagementEvidence,
  SANCTIONS_POLICY: loadSanctionsPolicyEvidence,
  CONTINGENCY_PLAN: loadContingencyPlanEvidence,
  // OSHA mode (added 2026-04-24)
  OSHA_BBP_PLAN: loadOshaBbpPlanEvidence,
  OSHA_HAZCOM: loadOshaHazcomEvidence,
  OSHA_300_LOG: loadOsha300LogEvidence,
  OSHA_PPE: loadOshaPpeEvidence,
  OSHA_EAP: loadOshaEapEvidence,
  OSHA_NEEDLESTICK: loadOshaNeedlestickEvidence,
  // CMS mode (added 2026-04-24 evening)
  CMS_ENROLLMENT: loadCmsEnrollmentEvidence,
  CMS_EP_PROGRAM: loadCmsEpProgramEvidence,
  CMS_BILLING: loadCmsBillingEvidence,
  CMS_OVERPAYMENT: loadCmsOverpaymentEvidence,
  CMS_RECORDS: loadCmsRecordsEvidence,
  CMS_OIG_SCREENING: loadCmsOigScreeningEvidence,
  // DEA mode (added 2026-04-24 evening)
  DEA_REGISTRATION: loadDeaRegistrationEvidence,
  DEA_INVENTORY: loadDeaInventoryEvidence,
  DEA_SECURITY: loadDeaSecurityEvidence,
  DEA_PDMP: loadDeaPdmpEvidence,
  DEA_PRESCRIPTIONS: loadDeaPrescriptionsEvidence,
  DEA_THEFT_LOSS: loadDeaTheftLossEvidence,
  // ALLERGY mode (added 2026-04-30, audit #21 IM-3)
  ALLERGY_COMPOUNDER_QUALIFICATION: loadAllergyCompounderQualification,
  ALLERGY_DRILL_LOG: loadAllergyDrillLog,
  ALLERGY_EQUIPMENT_LOG: loadAllergyEquipmentLog,
  ALLERGY_QUIZ_ATTEMPTS: loadAllergyQuizAttempts,
  ALLERGY_USP21_DEVIATIONS: loadAllergyDeviations,
};
