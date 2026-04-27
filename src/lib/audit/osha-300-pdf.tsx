// src/lib/audit/osha-300-pdf.tsx
//
// OSHA Form 300 — Log of Work-Related Injuries and Illnesses
// (per 29 CFR §1904.4). Annual log filed alongside Form 300A. One row
// per recordable case in the calendar year. v2 renders the columns the
// schema can populate; columns the schema lacks (job title, location,
// detailed onset date) are left as printed-blank cells the practice
// can fill in by hand before filing.

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 32,
    fontFamily: "Helvetica",
    fontSize: 8,
    color: "#1E293B",
  },
  practice: { fontSize: 9, color: "#64748B", marginBottom: 4 },
  title: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 2,
  },
  subtitle: { fontSize: 9, color: "#475569", marginBottom: 14 },
  hint: { fontSize: 8, color: "#94A3B8", fontStyle: "italic", marginBottom: 8 },
  rowHeader: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#94A3B8",
    fontWeight: "bold",
    color: "#1E3A5F",
    fontSize: 8,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  cellCase: { width: "8%", paddingRight: 4 },
  cellDate: { width: "10%", paddingRight: 4 },
  cellEmployee: { width: "16%", paddingRight: 4 },
  cellTitle: { width: "20%", paddingRight: 4 },
  cellInjury: { width: "16%", paddingRight: 4 },
  cellOutcome: { width: "14%", paddingRight: 4 },
  cellDays: { width: "8%", paddingRight: 4 },
  cellRest: { width: "8%" },
  cellWrap: { fontSize: 8, color: "#1E293B" },
  emptyState: {
    fontSize: 10,
    color: "#94A3B8",
    fontStyle: "italic",
    paddingVertical: 18,
    textAlign: "center",
  },
  totalsRow: {
    flexDirection: "row",
    paddingVertical: 6,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#1E3A5F",
    fontWeight: "bold",
    fontSize: 9,
  },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 32,
    right: 32,
    fontSize: 7,
    color: "#94A3B8",
    textAlign: "center",
  },
});

const OUTCOME_LABELS: Record<string, string> = {
  DEATH: "Death",
  DAYS_AWAY: "Days away",
  RESTRICTED: "Job restriction",
  OTHER_RECORDABLE: "Other recordable",
  FIRST_AID: "First aid only",
};

export interface Osha300Row {
  caseNumber: string;
  injuryDate: Date;
  employeeName: string | null;
  injuryNature: string | null;
  outcome: string | null;
  daysAway: number | null;
  daysRestricted: number | null;
}

export interface Osha300Input {
  practiceName: string;
  practiceState: string;
  year: number;
  generatedAt: Date;
  rows: Osha300Row[];
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function Osha300Document({ input }: { input: Osha300Input }) {
  const totals = input.rows.reduce(
    (acc, r) => {
      acc.daysAway += r.daysAway ?? 0;
      acc.daysRestricted += r.daysRestricted ?? 0;
      if (r.outcome === "DEATH") acc.deaths += 1;
      if (r.outcome === "DAYS_AWAY") acc.daysAwayCases += 1;
      if (r.outcome === "RESTRICTED") acc.restrictedCases += 1;
      if (r.outcome === "OTHER_RECORDABLE") acc.otherCases += 1;
      return acc;
    },
    {
      daysAway: 0,
      daysRestricted: 0,
      deaths: 0,
      daysAwayCases: 0,
      restrictedCases: 0,
      otherCases: 0,
    },
  );

  return (
    <Document
      title={`OSHA 300 ${input.year} — ${input.practiceName}`}
      author="GuardWell"
      subject="OSHA Form 300 Log of Work-Related Injuries and Illnesses"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.practice}>
          {input.practiceName} · {input.practiceState}
        </Text>
        <Text style={s.title}>OSHA Form 300 — {input.year} Log</Text>
        <Text style={s.subtitle}>
          Log of Work-Related Injuries and Illnesses · 29 CFR §1904.4
        </Text>
        <Text style={s.hint}>
          Some columns (job title, location of injury) are not stored in
          GuardWell. Hand-write before submission to OSHA.
        </Text>
        <Text style={s.hint}>
          The Employee column reflects the user who reported each incident,
          not necessarily the injured staff member. Verify and hand-correct
          before filing with OSHA.
        </Text>

        {input.rows.length === 0 ? (
          <Text style={s.emptyState}>
            No OSHA-recordable incidents recorded in {input.year}.
          </Text>
        ) : (
          <>
            <View style={s.rowHeader}>
              <Text style={s.cellCase}>Case #</Text>
              <Text style={s.cellDate}>Date</Text>
              <Text style={s.cellEmployee}>Employee</Text>
              <Text style={s.cellTitle}>Job title / location</Text>
              <Text style={s.cellInjury}>Injury / illness</Text>
              <Text style={s.cellOutcome}>Outcome</Text>
              <Text style={s.cellDays}>Days away</Text>
              <Text style={s.cellRest}>Days rest</Text>
            </View>
            {input.rows.map((r, i) => (
              <View key={i} style={s.row}>
                <Text style={s.cellCase}>{r.caseNumber}</Text>
                <Text style={s.cellDate}>{formatDate(r.injuryDate)}</Text>
                <Text style={s.cellEmployee}>{r.employeeName ?? "—"}</Text>
                <Text style={s.cellTitle}> </Text>
                <Text style={[s.cellInjury, s.cellWrap]}>
                  {r.injuryNature ?? "—"}
                </Text>
                <Text style={s.cellOutcome}>
                  {r.outcome
                    ? OUTCOME_LABELS[r.outcome] ?? r.outcome
                    : "—"}
                </Text>
                <Text style={s.cellDays}>
                  {r.daysAway === null ? "—" : r.daysAway}
                </Text>
                <Text style={s.cellRest}>
                  {r.daysRestricted === null ? "—" : r.daysRestricted}
                </Text>
              </View>
            ))}

            <View style={s.totalsRow}>
              <Text style={s.cellCase}>Totals</Text>
              <Text style={s.cellDate}>{input.rows.length} cases</Text>
              <Text style={s.cellEmployee}>
                {totals.deaths} death{totals.deaths === 1 ? "" : "s"}
              </Text>
              <Text style={s.cellTitle}>
                {totals.daysAwayCases} days-away · {totals.restrictedCases} restricted ·{" "}
                {totals.otherCases} other
              </Text>
              <Text style={s.cellInjury}> </Text>
              <Text style={s.cellOutcome}> </Text>
              <Text style={s.cellDays}>{totals.daysAway}</Text>
              <Text style={s.cellRest}>{totals.daysRestricted}</Text>
            </View>
          </>
        )}

        <Text style={s.footer} fixed>
          Generated {formatDate(input.generatedAt)} · OSHA Form 300 · GuardWell
        </Text>
      </Page>
    </Document>
  );
}
