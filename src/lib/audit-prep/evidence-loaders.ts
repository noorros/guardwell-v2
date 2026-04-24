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

export type EvidenceSnapshot =
  | NppEvidence
  | WorkforceTrainingEvidence
  | RiskAnalysisEvidence
  | RiskManagementEvidence
  | SanctionsPolicyEvidence
  | ContingencyPlanEvidence;

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
};
