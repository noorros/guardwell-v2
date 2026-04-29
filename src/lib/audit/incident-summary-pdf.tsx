// src/lib/audit/incident-summary-pdf.tsx
//
// Incident summary PDF — table grouped by status, with breach
// determinations highlighted. Useful for: HHS OCR audit response,
// HIPAA program review, board summary of compliance events.

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
  emptyState: {
    fontSize: 10,
    color: "#94A3B8",
    fontStyle: "italic",
    paddingVertical: 8,
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
  cellTitle: { width: "30%", paddingRight: 6 },
  cellType: { width: "15%", paddingRight: 6 },
  cellSeverity: { width: "10%", paddingRight: 6 },
  cellDiscovered: { width: "12%", paddingRight: 6 },
  cellBreach: { width: "13%", paddingRight: 6 },
  cellAffected: { width: "10%", paddingRight: 6 },
  cellResolved: { width: "10%" },
  breach: { color: "#B91C1C", fontWeight: "bold" },
  notBreach: { color: "#15803D" },
  undetermined: { color: "#D97706" },
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

export interface IncidentRow {
  title: string;
  type: string;
  severity: string;
  discoveredAt: Date;
  resolvedAt: Date | null;
  isBreach: boolean | null;
  affectedCount: number | null;
  status: string;
}

export interface IncidentSummaryInput {
  practiceName: string;
  practiceState: string;
  practiceTimezone: string;
  generatedAt: Date;
  incidents: IncidentRow[];
}

export function IncidentSummaryDocument({
  input,
}: {
  input: IncidentSummaryInput;
}) {
  // Group by status: Open + Under-investigation, Resolved, Closed
  const open = input.incidents.filter(
    (i) => i.status === "OPEN" || i.status === "UNDER_INVESTIGATION",
  );
  const resolved = input.incidents.filter((i) => i.status === "RESOLVED");
  const closed = input.incidents.filter((i) => i.status === "CLOSED");
  const breaches = input.incidents.filter((i) => i.isBreach === true);
  const unresolvedBreaches = breaches.filter((i) => i.resolvedAt === null);

  return (
    <Document
      title={`Incident summary — ${input.practiceName}`}
      author="GuardWell"
      subject="Incident summary"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>Incident Summary</Text>
        <Text style={s.subtitle}>
          {input.practiceName} · {input.practiceState}
        </Text>
        <Text style={s.meta}>
          Generated {formatPracticeDate(input.generatedAt, input.practiceTimezone)} ·{" "}
          {input.incidents.length} total incident
          {input.incidents.length === 1 ? "" : "s"}
        </Text>
        <Text style={s.meta}>
          {open.length} open · {breaches.length} confirmed breach
          {breaches.length === 1 ? "" : "es"}{" "}
          {unresolvedBreaches.length > 0
            ? `(${unresolvedBreaches.length} unresolved)`
            : ""}
        </Text>

        {open.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Open + Under investigation</Text>
            <SectionTable rows={open} timezone={input.practiceTimezone} />
          </>
        )}

        {resolved.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Resolved</Text>
            <SectionTable rows={resolved} timezone={input.practiceTimezone} />
          </>
        )}

        {closed.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Closed</Text>
            <SectionTable rows={closed} timezone={input.practiceTimezone} />
          </>
        )}

        {input.incidents.length === 0 && (
          <Text style={s.emptyState}>
            No incidents recorded yet for this practice.
          </Text>
        )}

        <Text style={s.footer} fixed>
          GuardWell — Incident Summary · Confidential
        </Text>
      </Page>
    </Document>
  );
}

function SectionTable({ rows, timezone }: { rows: IncidentRow[]; timezone: string }) {
  return (
    <View>
      <View style={s.rowHeader}>
        <Text style={s.cellTitle}>Title</Text>
        <Text style={s.cellType}>Type</Text>
        <Text style={s.cellSeverity}>Severity</Text>
        <Text style={s.cellDiscovered}>Discovered</Text>
        <Text style={s.cellBreach}>Breach?</Text>
        <Text style={s.cellAffected}>Affected</Text>
        <Text style={s.cellResolved}>Resolved</Text>
      </View>
      {rows.map((r, i) => {
        const breachStyle =
          r.isBreach === true
            ? s.breach
            : r.isBreach === false
              ? s.notBreach
              : s.undetermined;
        const breachLabel =
          r.isBreach === true
            ? "Yes"
            : r.isBreach === false
              ? "No"
              : "Undetermined";
        return (
          <View key={i} style={s.row}>
            <Text style={s.cellTitle}>{r.title}</Text>
            <Text style={s.cellType}>{r.type.replace(/_/g, " ")}</Text>
            <Text style={s.cellSeverity}>{r.severity}</Text>
            <Text style={s.cellDiscovered}>
              {formatPracticeDate(r.discoveredAt, timezone)}
            </Text>
            <Text style={[s.cellBreach, breachStyle]}>{breachLabel}</Text>
            <Text style={s.cellAffected}>
              {r.affectedCount === null ? "—" : r.affectedCount.toLocaleString("en-US")}
            </Text>
            <Text style={s.cellResolved}>
              {r.resolvedAt ? formatPracticeDate(r.resolvedAt, timezone) : "—"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
