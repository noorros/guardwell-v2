// src/app/api/audit/compliance-report/route.ts
//
// GET /api/audit/compliance-report
// Renders the practice's compliance snapshot PDF. Queries mirror the
// /audit/overview server component so totals stay in sync.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  getPracticeJurisdictions,
  jurisdictionRequirementFilter,
} from "@/lib/compliance/jurisdictions";
import {
  ComplianceReportDocument,
  type ComplianceReportInput,
} from "@/lib/audit/compliance-report-pdf";

export const maxDuration = 120;

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pu = await getPracticeUser();
  if (!pu) {
    return NextResponse.json({ error: "No practice" }, { status: 401 });
  }

  const jurisdictions = getPracticeJurisdictions(pu.practice);
  const jurisdictionClause = jurisdictionRequirementFilter(jurisdictions);

  const [
    practiceFrameworks,
    applicableRequirements,
    complianceItems,
    latestSra,
    openIncidentCount,
    unresolvedBreachCount,
    recentIncidents,
  ] = await Promise.all([
    db.practiceFramework.findMany({
      where: {
        practiceId: pu.practiceId,
        enabled: true,
        disabledAt: null,
      },
      include: { framework: true },
      orderBy: { framework: { sortOrder: "asc" } },
    }),
    db.regulatoryRequirement.findMany({
      where: { ...jurisdictionClause },
      select: {
        id: true,
        code: true,
        frameworkId: true,
        title: true,
        citation: true,
        severity: true,
        framework: { select: { code: true } },
      },
    }),
    db.complianceItem.findMany({
      where: { practiceId: pu.practiceId },
      select: { requirementId: true, status: true },
    }),
    db.practiceSraAssessment.findFirst({
      where: {
        practiceId: pu.practiceId,
        isDraft: false,
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      select: {
        completedAt: true,
        overallScore: true,
        addressedCount: true,
        totalCount: true,
      },
    }),
    db.incident.count({
      where: {
        practiceId: pu.practiceId,
        status: { in: ["OPEN", "UNDER_INVESTIGATION"] },
      },
    }),
    db.incident.count({
      where: {
        practiceId: pu.practiceId,
        isBreach: true,
        resolvedAt: null,
      },
    }),
    db.incident.findMany({
      where: { practiceId: pu.practiceId },
      orderBy: { discoveredAt: "desc" },
      take: 12,
      select: {
        title: true,
        type: true,
        status: true,
        isBreach: true,
        discoveredAt: true,
      },
    }),
  ]);

  const applicableIdSet = new Set(applicableRequirements.map((r) => r.id));
  const compliantItems = complianceItems.filter(
    (ci) => ci.status === "COMPLIANT" && applicableIdSet.has(ci.requirementId),
  );
  const totalApplicable = applicableRequirements.length;
  const overallScore =
    totalApplicable === 0
      ? 0
      : Math.round((compliantItems.length / totalApplicable) * 100);
  const isAssessed = complianceItems.length > 0;

  const reqById = new Map(applicableRequirements.map((r) => [r.id, r]));
  const criticalGaps = complianceItems
    .filter((ci) => ci.status === "GAP")
    .map((ci) => reqById.get(ci.requirementId))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .filter((r) => r.severity === "CRITICAL")
    .map((r) => ({
      frameworkCode: r.framework.code,
      requirementCode: r.code,
      title: r.title,
      citation: r.citation,
      severity: r.severity,
    }));

  const frameworkRows = practiceFrameworks.map((pf) => {
    const frameworkReqs = applicableRequirements.filter(
      (r) => r.frameworkId === pf.frameworkId,
    );
    const frameworkCompliant = complianceItems.filter(
      (ci) =>
        ci.status === "COMPLIANT" &&
        frameworkReqs.some((r) => r.id === ci.requirementId),
    ).length;
    const frameworkAssessed = complianceItems.some((ci) =>
      frameworkReqs.some((r) => r.id === ci.requirementId),
    );
    return {
      code: pf.framework.code,
      name: pf.framework.name,
      shortName: pf.framework.shortName,
      score: Math.round(pf.scoreCache ?? 0),
      compliant: frameworkCompliant,
      total: frameworkReqs.length,
      assessed: frameworkAssessed,
    };
  });

  const input: ComplianceReportInput = {
    practice: {
      name: pu.practice.name,
      primaryState: pu.practice.primaryState,
      operatingStates: pu.practice.operatingStates,
    },
    generatedAt: new Date(),
    generatedByEmail: user.email,
    overallScore,
    compliantCount: compliantItems.length,
    totalApplicable,
    isAssessed,
    jurisdictions,
    frameworks: frameworkRows,
    criticalGaps,
    sra: {
      completedAt: latestSra?.completedAt ?? null,
      overallScore: latestSra?.overallScore ?? null,
      addressedCount: latestSra?.addressedCount ?? null,
      totalCount: latestSra?.totalCount ?? null,
    },
    incidents: {
      unresolvedBreachCount,
      openCount: openIncidentCount,
      recent: recentIncidents,
    },
  };

  const buffer = await renderToBuffer(ComplianceReportDocument(input));

  const filename = `compliance-report-${pu.practice.name
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
