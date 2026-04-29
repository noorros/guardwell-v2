// src/lib/audit/dea-form-106-pdf.tsx
//
// DEA Form 106 — Report of Theft or Loss of Controlled Substances
// (per 21 CFR §1301.74(c)). Filed within 1 business day of discovery
// of any theft or significant loss of controlled substances.
//
// Phase D scope: this implementation renders a single-row Form 106 for
// one DeaTheftLossReport. The federal form is a multi-row table; v1
// launches single-row because most healthcare practices report one
// drug per theft/loss event. Future multi-drug Form 106 (renders all
// rows sharing a `reportBatchId`) is post-launch.
//
// Style mirrors dea-form-41-pdf.tsx — same metaBlank pattern for
// hand-fillable signature blanks.

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { SCHEDULE_LABELS, LOSS_TYPE_LABELS } from "@/lib/dea/labels";
import { formatPracticeDate, formatPracticeDateTime } from "@/lib/audit/format";

const s = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1E293B",
  },
  practice: { fontSize: 9, color: "#64748B", marginBottom: 4 },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 4,
  },
  subtitle: { fontSize: 10, color: "#475569", marginBottom: 16 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#94A3B8",
    paddingBottom: 3,
  },
  metaRow: { flexDirection: "row", marginBottom: 4 },
  metaLabel: { width: 180, color: "#64748B", fontSize: 9 },
  metaValue: { flex: 1, fontSize: 10, color: "#1E293B" },
  metaBlank: {
    flex: 1,
    fontSize: 10,
    color: "#1E293B",
    borderBottomWidth: 0.5,
    borderBottomColor: "#94A3B8",
    minHeight: 14,
  },
  notes: { fontSize: 10, color: "#1E293B", lineHeight: 1.5 },
  // Item table
  tHead: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#94A3B8",
  },
  tRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  tCell: { fontSize: 9, color: "#1E293B" },
  tCellHead: {
    fontSize: 8,
    color: "#475569",
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  // Column widths (sum = 100%)
  cSchedule: { width: "12%" },
  cDrug: { width: "30%" },
  cNdc: { width: "18%" },
  cStrength: { width: "16%" },
  cQty: { width: "12%", textAlign: "right" },
  cUnit: { width: "12%" },
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

export interface DeaForm106ItemRow {
  schedule: string;
  drugName: string;
  ndc: string | null;
  strength: string | null;
  quantityLost: number;
  unit: string;
}

export interface DeaForm106Input {
  practiceName: string;
  practiceState: string;
  practiceTimezone: string;
  generatedAt: Date;
  report: {
    discoveredAt: Date;
    lossType: string;
    methodOfDiscovery: string | null;
    lawEnforcementNotified: boolean;
    lawEnforcementAgency: string | null;
    lawEnforcementCaseNumber: string | null;
    deaNotifiedAt: Date | null;
    form106SubmittedAt: Date | null;
    reportedByName: string | null;
    notes: string | null;
    items: DeaForm106ItemRow[];
  };
}

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

function lossTypeLabel(lt: string): string {
  return LOSS_TYPE_LABELS[lt] ?? lt;
}

function scheduleLabel(s: string): string {
  return SCHEDULE_LABELS[s as keyof typeof SCHEDULE_LABELS] ?? s;
}

export function DeaForm106Document({
  input,
}: {
  input: DeaForm106Input;
}) {
  const { report } = input;
  return (
    <Document
      title={`DEA Form 106 — Theft/Loss ${formatPracticeDate(report.discoveredAt, input.practiceTimezone)}`}
      author="GuardWell"
      subject="DEA Form 106 — Report of Theft or Loss of Controlled Substances (21 CFR §1301.74(c))"
    >
      <Page size="LETTER" style={s.page}>
        {/* 1. Practice header */}
        <Text style={s.practice}>
          {input.practiceName} · {input.practiceState}
        </Text>

        {/* 2. Title block */}
        <Text style={s.title}>
          DEA Form 106 — Report of Theft or Loss of Controlled Substances
        </Text>
        <Text style={s.subtitle}>21 CFR §1301.74(c)</Text>

        {/* 3. Registrant info — full address is not stored; render as
            a hand-fillable blank so the registrant can complete it
            before filing. */}
        <Text style={s.sectionTitle}>Registrant</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Registrant name</Text>
          <Text style={s.metaValue}>{input.practiceName}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Primary state</Text>
          <Text style={s.metaValue}>{input.practiceState}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Address (street, city, ZIP)</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>DEA registration #</Text>
          <Text style={s.metaBlank}> </Text>
        </View>

        {/* 4. Theft / loss event details */}
        <Text style={s.sectionTitle}>Event details</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Date discovered</Text>
          <Text style={s.metaValue}>{formatPracticeDate(report.discoveredAt, input.practiceTimezone)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Loss type</Text>
          <Text style={s.metaValue}>{lossTypeLabel(report.lossType)}</Text>
        </View>

        <View style={s.tHead}>
          <Text style={[s.tCellHead, s.cSchedule]}>Schedule</Text>
          <Text style={[s.tCellHead, s.cDrug]}>Drug</Text>
          <Text style={[s.tCellHead, s.cNdc]}>NDC</Text>
          <Text style={[s.tCellHead, s.cStrength]}>Strength</Text>
          <Text style={[s.tCellHead, s.cQty]}>Qty lost</Text>
          <Text style={[s.tCellHead, s.cUnit]}>Unit</Text>
        </View>
        {report.items.map((it, i) => (
          <View key={i} style={s.tRow}>
            <Text style={[s.tCell, s.cSchedule]}>
              {scheduleLabel(it.schedule)}
            </Text>
            <Text style={[s.tCell, s.cDrug]}>{it.drugName}</Text>
            <Text style={[s.tCell, s.cNdc]}>{dash(it.ndc)}</Text>
            <Text style={[s.tCell, s.cStrength]}>{dash(it.strength)}</Text>
            <Text style={[s.tCell, s.cQty]}>
              {it.quantityLost.toLocaleString("en-US")}
            </Text>
            <Text style={[s.tCell, s.cUnit]}>{it.unit}</Text>
          </View>
        ))}

        <View style={[s.metaRow, { marginTop: 6 }]}>
          <Text style={s.metaLabel}>Method of discovery</Text>
          <Text style={s.notes}>{dash(report.methodOfDiscovery)}</Text>
        </View>

        {/* 5. Notifications block */}
        <Text style={s.sectionTitle}>Notifications</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Law enforcement notified</Text>
          <Text style={s.metaValue}>
            {report.lawEnforcementNotified ? "Yes" : "No"}
          </Text>
        </View>
        {report.lawEnforcementNotified && (
          <>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Agency</Text>
              <Text style={s.metaValue}>
                {dash(report.lawEnforcementAgency)}
              </Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Case number</Text>
              <Text style={s.metaValue}>
                {dash(report.lawEnforcementCaseNumber)}
              </Text>
            </View>
          </>
        )}
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>DEA notified at</Text>
          <Text style={s.metaValue}>
            {report.deaNotifiedAt ? formatPracticeDate(report.deaNotifiedAt, input.practiceTimezone) : "Pending"}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Form 106 submitted at</Text>
          <Text style={s.metaValue}>
            {report.form106SubmittedAt
              ? formatPracticeDate(report.form106SubmittedAt, input.practiceTimezone)
              : "Pending"}
          </Text>
        </View>

        {report.notes && (
          <>
            <Text style={[s.metaLabel, { marginTop: 6 }]}>Notes</Text>
            <Text style={s.notes}>{report.notes}</Text>
          </>
        )}

        {/* 6. Reported by + signature block */}
        <Text style={s.sectionTitle}>Signatures</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Reported by</Text>
          <Text style={s.metaValue}>{dash(report.reportedByName)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Signature of registrant</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Date</Text>
          <Text style={s.metaBlank}> </Text>
        </View>

        {/* 7. Footer */}
        <Text style={s.footer} fixed>
          Generated {formatPracticeDateTime(input.generatedAt, input.practiceTimezone)} · GuardWell · Confidential
        </Text>
      </Page>
    </Document>
  );
}
