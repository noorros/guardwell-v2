// src/lib/audit/training-summary-pdf.tsx
//
// Training summary PDF — per-staff completion grid + expiration window.
// Useful for: HR audits, OSHA compliance review, "show me who's
// actually trained" snapshots.

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
    fontSize: 9,
    color: "#1E293B",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: "#64748B",
    marginBottom: 18,
  },
  meta: {
    fontSize: 9,
    color: "#475569",
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginTop: 18,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 3,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
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
  cellStaff: { width: "30%", paddingRight: 6 },
  cellCourse: { width: "30%", paddingRight: 6 },
  cellCompleted: { width: "20%", paddingRight: 6 },
  cellExpires: { width: "20%" },
  expiringSoon: { color: "#D97706" },
  expired: { color: "#B91C1C" },
  current: { color: "#15803D" },
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

export interface TrainingCompletionRow {
  staffName: string;
  staffEmail: string;
  staffRole: string;
  courseCode: string;
  courseTitle: string;
  passed: boolean;
  score: number;
  completedAt: Date;
  expiresAt: Date;
}

export interface TrainingSummaryInput {
  practiceName: string;
  practiceState: string;
  practiceTimezone: string;
  generatedAt: Date;
  totalStaff: number;
  completions: TrainingCompletionRow[];
}

export function TrainingSummaryDocument({ input }: { input: TrainingSummaryInput }) {
  const now = input.generatedAt.getTime();
  // Bucket: expired (past), expiring within 60 days, current (>60 days)
  const expired = input.completions.filter((c) => c.expiresAt.getTime() < now);
  const expiringSoon = input.completions.filter(
    (c) =>
      c.expiresAt.getTime() >= now &&
      c.expiresAt.getTime() < now + 60 * 24 * 60 * 60 * 1000,
  );
  const current = input.completions.filter(
    (c) => c.expiresAt.getTime() >= now + 60 * 24 * 60 * 60 * 1000,
  );

  // Per-staff completion count for the cover summary.
  const byStaff = new Map<string, number>();
  for (const c of input.completions) {
    byStaff.set(c.staffEmail, (byStaff.get(c.staffEmail) ?? 0) + 1);
  }

  return (
    <Document
      title={`Training summary — ${input.practiceName}`}
      author="GuardWell"
      subject="Training summary"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>Training Summary</Text>
        <Text style={s.subtitle}>{input.practiceName} · {input.practiceState}</Text>
        <Text style={s.meta}>
          Generated {formatPracticeDate(input.generatedAt, input.practiceTimezone)} · {input.totalStaff} active staff member{input.totalStaff === 1 ? "" : "s"}
        </Text>
        <Text style={s.meta}>
          Active completions: {current.length} current · {expiringSoon.length} expiring within 60 days · {expired.length} expired
        </Text>

        {expired.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Expired (action required)</Text>
            <SectionTable rows={expired} statusStyle={s.expired} statusLabel="Expired" timezone={input.practiceTimezone} />
          </>
        )}

        {expiringSoon.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Expiring within 60 days</Text>
            <SectionTable rows={expiringSoon} statusStyle={s.expiringSoon} statusLabel="Due soon" timezone={input.practiceTimezone} />
          </>
        )}

        {current.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Current</Text>
            <SectionTable rows={current} statusStyle={s.current} statusLabel="Current" timezone={input.practiceTimezone} />
          </>
        )}

        {input.completions.length === 0 && (
          <Text style={s.emptyState}>
            No training completions recorded yet for this practice.
          </Text>
        )}

        <Text style={s.footer} fixed>
          GuardWell — Training Summary · Page rendered for compliance audit
        </Text>
      </Page>
    </Document>
  );
}

function SectionTable({
  rows,
  statusStyle,
  statusLabel,
  timezone,
}: {
  rows: TrainingCompletionRow[];
  statusStyle: { color: string };
  statusLabel: string;
  timezone: string;
}) {
  return (
    <View>
      <View style={s.rowHeader}>
        <Text style={s.cellStaff}>Staff member</Text>
        <Text style={s.cellCourse}>Course</Text>
        <Text style={s.cellCompleted}>Completed</Text>
        <Text style={s.cellExpires}>Expires</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.row}>
          <Text style={s.cellStaff}>
            {r.staffName} ({r.staffRole})
          </Text>
          <Text style={s.cellCourse}>{r.courseTitle}</Text>
          <Text style={s.cellCompleted}>
            {formatPracticeDate(r.completedAt, timezone)}{" "}
            {r.passed ? `(${r.score}%)` : "(failed)"}
          </Text>
          <Text style={[s.cellExpires, statusStyle]}>
            {formatPracticeDate(r.expiresAt, timezone)} · {statusLabel}
          </Text>
        </View>
      ))}
    </View>
  );
}
