// src/lib/audit/pp-attestation-pdf.tsx
//
// Annual Policies & Procedures Review Attestation PDF — list of every
// adopted policy with version, last review date, and reviewer status.
// Used for: HIPAA §164.530(i)(2) annual review attestation, board
// minutes, OCR audit response. Includes a signature block at the bottom
// for the Privacy Officer to physically sign before filing.

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { formatPracticeDate } from "@/lib/audit/format";

const s = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1E293B",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 4,
  },
  subtitle: { fontSize: 11, color: "#64748B", marginBottom: 18 },
  meta: { fontSize: 9, color: "#475569", marginBottom: 2 },
  intro: {
    fontSize: 10,
    color: "#1E293B",
    marginTop: 14,
    marginBottom: 8,
    lineHeight: 1.5,
  },
  citation: {
    fontSize: 9,
    color: "#64748B",
    marginBottom: 14,
    fontStyle: "italic",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginTop: 14,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 3,
  },
  rowHeader: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#94A3B8",
    fontWeight: "bold",
    color: "#1E3A5F",
    fontSize: 9,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  cellPolicy: { width: "44%", paddingRight: 6 },
  cellVersion: { width: "12%", paddingRight: 6 },
  cellReviewed: { width: "22%", paddingRight: 6 },
  cellStatus: { width: "22%" },
  current: { color: "#15803D" },
  stale: { color: "#D97706" },
  overdue: { color: "#B91C1C" },
  attestation: {
    marginTop: 28,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1E3A5F",
    backgroundColor: "#F8FAFC",
  },
  attestationHeader: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 6,
  },
  attestationBody: {
    fontSize: 10,
    color: "#1E293B",
    lineHeight: 1.5,
    marginBottom: 14,
  },
  signatureRow: {
    flexDirection: "row",
    marginTop: 18,
    gap: 18,
  },
  signatureCell: { flex: 1 },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#1E3A5F",
    height: 24,
  },
  signatureLabel: { fontSize: 9, color: "#64748B", marginTop: 4 },
  emptyState: {
    fontSize: 10,
    color: "#94A3B8",
    fontStyle: "italic",
    paddingVertical: 8,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    fontSize: 8,
    color: "#94A3B8",
    textAlign: "center",
  },
});

const REVIEW_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const STALE_WINDOW_MS = 305 * 24 * 60 * 60 * 1000; // 60 days before due

export interface PolicyRow {
  policyCode: string;
  policyTitle: string;
  version: number;
  adoptedAt: Date;
  lastReviewedAt: Date | null;
}

export interface PpAttestationInput {
  practiceName: string;
  practiceState: string;
  practiceTimezone: string;
  generatedAt: Date;
  privacyOfficerName: string | null;
  policies: PolicyRow[];
}

function statusFor(p: PolicyRow, now: number): {
  label: string;
  style: { color: string };
} {
  const reviewedAt = p.lastReviewedAt?.getTime() ?? p.adoptedAt.getTime();
  const age = now - reviewedAt;
  if (age >= REVIEW_WINDOW_MS) return { label: "OVERDUE", style: s.overdue };
  if (age >= STALE_WINDOW_MS) return { label: "Due soon", style: s.stale };
  return { label: "Current", style: s.current };
}

export function PpAttestationDocument({ input }: { input: PpAttestationInput }) {
  const now = input.generatedAt.getTime();
  const overdue = input.policies.filter(
    (p) =>
      now -
        (p.lastReviewedAt?.getTime() ?? p.adoptedAt.getTime()) >=
      REVIEW_WINDOW_MS,
  ).length;

  return (
    <Document
      title={`Annual P&P Review Attestation — ${input.practiceName}`}
      author="GuardWell"
      subject="Annual P&P Review Attestation"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>Annual P&amp;P Review Attestation</Text>
        <Text style={s.subtitle}>
          {input.practiceName} · {input.practiceState}
        </Text>
        <Text style={s.meta}>
          Generated {formatPracticeDate(input.generatedAt, input.practiceTimezone)} ·{" "}
          {input.policies.length} adopted polic
          {input.policies.length === 1 ? "y" : "ies"} · {overdue} overdue
        </Text>

        <Text style={s.intro}>
          This attestation documents the annual review of {input.practiceName}'s
          policies and procedures by the Privacy Officer, as required for
          covered entities and business associates that maintain HIPAA
          compliance programs.
        </Text>
        <Text style={s.citation}>
          45 CFR §164.530(i)(2) — covered entities must periodically review
          and modify their policies and procedures as the law changes.
        </Text>

        {input.policies.length === 0 ? (
          <Text style={s.emptyState}>
            No policies adopted yet. Adopt policies via My Programs › Policies
            before completing this attestation.
          </Text>
        ) : (
          <>
            <Text style={s.sectionTitle}>Policies under review</Text>
            <View style={s.rowHeader}>
              <Text style={s.cellPolicy}>Policy</Text>
              <Text style={s.cellVersion}>Version</Text>
              <Text style={s.cellReviewed}>Last reviewed</Text>
              <Text style={s.cellStatus}>Status</Text>
            </View>
            {input.policies.map((p, i) => {
              const status = statusFor(p, now);
              const reviewed = p.lastReviewedAt ?? p.adoptedAt;
              return (
                <View key={i} style={s.row}>
                  <Text style={s.cellPolicy}>{p.policyTitle}</Text>
                  <Text style={s.cellVersion}>v{p.version}</Text>
                  <Text style={s.cellReviewed}>
                    {formatPracticeDate(reviewed, input.practiceTimezone)}
                  </Text>
                  <Text style={[s.cellStatus, status.style]}>{status.label}</Text>
                </View>
              );
            })}
          </>
        )}

        <View style={s.attestation}>
          <Text style={s.attestationHeader}>Privacy Officer Attestation</Text>
          <Text style={s.attestationBody}>
            I, the undersigned Privacy Officer for {input.practiceName}, hereby
            attest that the policies and procedures listed above have been
            reviewed in accordance with 45 CFR §164.530(i)(2). I confirm that
            each policy remains accurate and effective for {input.practiceName}'s
            current operations, or has been updated to reflect changes in law,
            regulatory guidance, or practice operations as of the date below.
          </Text>
          <View style={s.signatureRow}>
            <View style={s.signatureCell}>
              <View style={s.signatureLine} />
              <Text style={s.signatureLabel}>
                Signature — {input.privacyOfficerName ?? "Privacy Officer"}
              </Text>
            </View>
            <View style={s.signatureCell}>
              <View style={s.signatureLine} />
              <Text style={s.signatureLabel}>Date</Text>
            </View>
          </View>
        </View>

        <Text style={s.footer} fixed>
          GuardWell — Annual P&amp;P Review Attestation · §164.530(i)(2)
        </Text>
      </Page>
    </Document>
  );
}
