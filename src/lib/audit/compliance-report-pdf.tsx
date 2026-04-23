// src/lib/audit/compliance-report-pdf.tsx
//
// v2 compliance snapshot PDF. Produces a single-practice, point-in-time
// readiness report suitable for audit prep, board packets, or sending to
// an outside counsel ahead of a review. Rendered via @react-pdf/renderer
// (server-side).
//
// Data shape matches the /audit/overview page so totals agree. Every
// count respects the practice's jurisdictions (federal + overlays).

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

// ── Styles ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1E293B",
  },
  coverTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 6,
  },
  coverSubtitle: {
    fontSize: 13,
    color: "#64748B",
    marginBottom: 28,
  },
  coverMeta: {
    fontSize: 10,
    color: "#475569",
    marginBottom: 3,
  },
  coverScore: {
    fontSize: 56,
    fontWeight: "bold",
    color: "#2563EB",
    marginTop: 36,
  },
  coverScoreLabel: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginTop: 20,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 4,
  },
  rowHeader: {
    flexDirection: "row",
    backgroundColor: "#F8FAFC",
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 6,
    marginBottom: 2,
    borderRadius: 3,
  },
  rowHeaderText: {
    fontSize: 9,
    color: "#64748B",
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  rowFrameworkName: { flex: 2, fontSize: 10, color: "#1E293B", fontWeight: "bold" },
  rowFrameworkCount: { flex: 1, fontSize: 10, color: "#475569" },
  rowFrameworkScore: { width: 48, fontSize: 10, color: "#475569", textAlign: "right" },
  itemRow: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 6,
  },
  statusBadge: {
    width: 72,
    fontSize: 8,
    fontWeight: "bold",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    textAlign: "center",
    marginRight: 8,
  },
  itemText: { fontSize: 9, color: "#334155", flex: 1 },
  itemCitation: { fontSize: 8, color: "#94A3B8", marginTop: 1 },
  callout: {
    padding: 8,
    marginTop: 6,
    borderRadius: 3,
    borderWidth: 0.5,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 8,
    color: "#94A3B8",
  },
  emptyText: {
    fontSize: 10,
    color: "#94A3B8",
    fontStyle: "italic",
    paddingLeft: 6,
    paddingVertical: 4,
  },
});

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  COMPLIANT: { bg: "#DCFCE7", text: "#166534", label: "COMPLIANT" },
  GAP: { bg: "#FEE2E2", text: "#991B1B", label: "GAP" },
  IN_PROGRESS: { bg: "#FEF9C3", text: "#854D0E", label: "IN PROGRESS" },
  NOT_APPLICABLE: { bg: "#F1F5F9", text: "#475569", label: "N/A" },
  NOT_STARTED: { bg: "#F1F5F9", text: "#94A3B8", label: "NOT STARTED" },
};

// ── Types ──────────────────────────────────────────────────────────────

export interface ComplianceReportInput {
  practice: {
    name: string;
    primaryState: string;
    operatingStates: string[];
  };
  generatedAt: Date;
  generatedByEmail: string;
  overallScore: number;
  compliantCount: number;
  totalApplicable: number;
  isAssessed: boolean;
  jurisdictions: string[];
  frameworks: Array<{
    code: string;
    name: string;
    shortName: string | null;
    score: number;
    compliant: number;
    total: number;
    assessed: boolean;
  }>;
  criticalGaps: Array<{
    frameworkCode: string;
    requirementCode: string;
    title: string;
    citation: string | null;
    severity: string;
  }>;
  sra: {
    completedAt: Date | null;
    overallScore: number | null;
    addressedCount: number | null;
    totalCount: number | null;
  };
  incidents: {
    unresolvedBreachCount: number;
    openCount: number;
    recent: Array<{
      title: string;
      type: string;
      status: string;
      isBreach: boolean | null;
      discoveredAt: Date;
    }>;
  };
}

// ── Component ──────────────────────────────────────────────────────────

const e = React.createElement;

export function ComplianceReportDocument(props: ComplianceReportInput) {
  const {
    practice,
    generatedAt,
    generatedByEmail,
    overallScore,
    compliantCount,
    totalApplicable,
    isAssessed,
    jurisdictions,
    frameworks,
    criticalGaps,
    sra,
    incidents,
  } = props;

  const generatedLabel = generatedAt.toISOString().slice(0, 10);
  const watermarkText = `Generated ${generatedLabel} by ${generatedByEmail}`;

  return e(
    Document,
    {},
    // ─── Cover page ─────────────────────────────────────────────────
    e(
      Page,
      { size: "LETTER", style: s.page },
      e(View, {}, [
        e(Text, { key: "t", style: s.coverTitle }, "Compliance readiness report"),
        e(Text, { key: "st", style: s.coverSubtitle }, practice.name),
        e(
          Text,
          { key: "js", style: s.coverMeta },
          `Jurisdictions: ${jurisdictions.join(", ")}`,
        ),
        e(
          Text,
          { key: "gd", style: s.coverMeta },
          `Generated: ${generatedAt.toUTCString()}`,
        ),
        e(
          Text,
          { key: "gb", style: s.coverMeta },
          `Generated by: ${generatedByEmail}`,
        ),
        isAssessed
          ? e(Text, { key: "sc", style: s.coverScore }, `${overallScore}%`)
          : e(Text, { key: "sc-na", style: s.coverScore }, "—"),
        e(
          Text,
          { key: "scl", style: s.coverScoreLabel },
          isAssessed
            ? `${compliantCount} of ${totalApplicable} applicable requirements met across ${frameworks.length} framework${frameworks.length === 1 ? "" : "s"}`
            : "No compliance items recorded yet for this practice",
        ),
      ]),
      e(
        View,
        { style: s.footer },
        e(Text, { style: s.footerText }, "GuardWell Compliance Report"),
        e(Text, { style: s.footerText }, watermarkText),
      ),
    ),

    // ─── Frameworks page ────────────────────────────────────────────
    e(
      Page,
      { size: "LETTER", style: s.page },
      e(Text, { style: s.sectionTitle }, "Framework breakdown"),
      e(
        View,
        { style: s.rowHeader },
        e(Text, { style: [s.rowHeaderText, { flex: 2 }] }, "Framework"),
        e(Text, { style: [s.rowHeaderText, { flex: 1 }] }, "Compliant / Total"),
        e(Text, { style: [s.rowHeaderText, { width: 48, textAlign: "right" }] }, "Score"),
      ),
      ...frameworks.map((fw) =>
        e(
          View,
          { style: s.row, key: fw.code },
          e(Text, { style: s.rowFrameworkName }, fw.shortName ?? fw.name),
          e(
            Text,
            { style: s.rowFrameworkCount },
            fw.assessed ? `${fw.compliant} of ${fw.total}` : "Not assessed",
          ),
          e(
            Text,
            { style: s.rowFrameworkScore },
            fw.assessed ? `${fw.score}%` : "—",
          ),
        ),
      ),

      // ─── Critical gaps ────────────────────────────────────────────
      e(Text, { style: s.sectionTitle }, "Critical gaps"),
      criticalGaps.length === 0
        ? e(Text, { style: s.emptyText }, "No critical-severity requirements currently at GAP.")
        : criticalGaps.slice(0, 20).map((g, idx) => {
            const variant = STATUS_STYLE.GAP!;
            return e(
              View,
              { style: s.itemRow, key: `gap-${idx}` },
              e(
                Text,
                {
                  style: [
                    s.statusBadge,
                    { backgroundColor: variant.bg, color: variant.text },
                  ],
                },
                "CRITICAL",
              ),
              e(
                View,
                { style: { flex: 1 } },
                e(Text, { style: s.itemText }, `${g.frameworkCode} · ${g.title}`),
                g.citation
                  ? e(Text, { style: s.itemCitation }, g.citation)
                  : null,
              ),
            );
          }),

      e(
        View,
        { style: s.footer },
        e(Text, { style: s.footerText }, "GuardWell Compliance Report"),
        e(Text, { style: s.footerText }, watermarkText),
      ),
    ),

    // ─── Obligations page ──────────────────────────────────────────
    e(
      Page,
      { size: "LETTER", style: s.page },
      e(Text, { style: s.sectionTitle }, "Security Risk Assessment"),
      sra.completedAt
        ? e(
            Text,
            { style: s.itemText },
            `Most recent SRA completed ${sra.completedAt.toISOString().slice(0, 10)}. ${
              sra.overallScore ?? 0
            }% addressed (${sra.addressedCount ?? 0} of ${sra.totalCount ?? 0} safeguards).`,
          )
        : e(Text, { style: s.emptyText }, "No completed Security Risk Assessment on file."),

      e(Text, { style: s.sectionTitle }, "Incidents"),
      e(
        Text,
        { style: s.itemText },
        `${incidents.openCount} open or under-investigation incident${
          incidents.openCount === 1 ? "" : "s"
        } · ${incidents.unresolvedBreachCount} unresolved breach${
          incidents.unresolvedBreachCount === 1 ? "" : "es"
        }.`,
      ),
      incidents.recent.length === 0
        ? e(Text, { style: s.emptyText }, "No incidents on file.")
        : incidents.recent.slice(0, 12).map((inc, idx) =>
            e(
              View,
              { style: s.itemRow, key: `inc-${idx}` },
              e(
                Text,
                {
                  style: [
                    s.statusBadge,
                    {
                      backgroundColor:
                        inc.isBreach === true ? "#FEE2E2" : "#F1F5F9",
                      color: inc.isBreach === true ? "#991B1B" : "#475569",
                    },
                  ],
                },
                inc.isBreach === true
                  ? "BREACH"
                  : inc.isBreach === false
                    ? "NOT BREACH"
                    : inc.status.replace(/_/g, " "),
              ),
              e(
                View,
                { style: { flex: 1 } },
                e(
                  Text,
                  { style: s.itemText },
                  `${inc.title} · ${inc.type.replace(/_/g, " ").toLowerCase()}`,
                ),
                e(
                  Text,
                  { style: s.itemCitation },
                  `Discovered ${inc.discoveredAt.toISOString().slice(0, 10)}`,
                ),
              ),
            ),
          ),

      e(
        View,
        { style: [s.callout, { borderColor: "#E2E8F0", marginTop: 24 }] },
        e(
          Text,
          { style: s.itemText },
          "This report is a compliance snapshot based on data recorded in GuardWell as of the generation time. It does not constitute legal advice. For audit response or breach-notification decisions, consult qualified counsel.",
        ),
      ),

      e(
        View,
        { style: s.footer },
        e(Text, { style: s.footerText }, "GuardWell Compliance Report"),
        e(Text, { style: s.footerText }, watermarkText),
      ),
    ),
  );
}
