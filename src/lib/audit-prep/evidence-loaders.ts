// src/lib/audit-prep/evidence-loaders.ts
//
// Pure async loaders that snapshot live compliance evidence into
// structured objects. Called when a step is marked complete. The output
// is persisted in AuditPrepStep.evidenceJson so the PDF stays stable
// even if underlying tables change later.

import type { Prisma } from "@prisma/client";

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
  | DeaTheftLossEvidence;

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
  const [recent12, allTime, mostRecent] = await Promise.all([
    tx.incident.count({
      where: {
        practiceId,
        type: "OSHA_RECORDABLE",
        discoveredAt: { gte: cutoff },
      },
    }),
    tx.incident.count({
      where: { practiceId, type: "OSHA_RECORDABLE" },
    }),
    tx.incident.findFirst({
      where: { practiceId, type: "OSHA_RECORDABLE" },
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
};
