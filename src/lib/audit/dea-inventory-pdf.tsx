// src/lib/audit/dea-inventory-pdf.tsx
//
// DEA biennial controlled-substance inventory PDF (per 21 CFR §1304.11).
// Single-snapshot document: practice header + inventory metadata +
// table of items + signature block. Mirrors the OSHA 301 hand-fillable
// signature pattern via metaBlank for the registrant signature line.

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
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
  metaLabel: { width: 130, color: "#64748B", fontSize: 9 },
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
  emptyState: {
    fontSize: 9,
    fontStyle: "italic",
    color: "#94A3B8",
    paddingVertical: 8,
    textAlign: "center",
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

const SCHEDULE_LABELS: Record<string, string> = {
  CI: "Schedule I",
  CII: "Schedule II",
  CIIN: "Schedule II-N",
  CIII: "Schedule III",
  CIIIN: "Schedule III-N",
  CIV: "Schedule IV",
  CV: "Schedule V",
};

export interface DeaInventoryItemRow {
  schedule: string;
  drugName: string;
  ndc: string | null;
  strength: string | null;
  quantity: number;
  unit: string;
}

export interface DeaInventoryInput {
  practiceName: string;
  practiceState: string;
  practiceTimezone: string;
  generatedAt: Date;
  inventory: {
    asOfDate: Date;
    conductedByName: string | null;
    witnessName: string | null;
    notes: string | null;
    items: DeaInventoryItemRow[];
  };
}

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

export function DeaInventoryDocument({
  input,
}: {
  input: DeaInventoryInput;
}) {
  const { inventory } = input;
  return (
    <Document
      title={`DEA Controlled Substance Inventory — ${formatPracticeDate(inventory.asOfDate, input.practiceTimezone)}`}
      author="GuardWell"
      subject="DEA Controlled Substance Inventory (21 CFR §1304.11)"
    >
      <Page size="LETTER" style={s.page}>
        {/* 1. Practice header */}
        <Text style={s.practice}>
          {input.practiceName} · {input.practiceState}
        </Text>

        {/* 2. Title block */}
        <Text style={s.title}>DEA Controlled Substance Inventory</Text>
        <Text style={s.subtitle}>21 CFR §1304.11 — Biennial Inventory</Text>

        {/* 3. Metadata */}
        <Text style={s.sectionTitle}>Inventory Information</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>As-of date</Text>
          <Text style={s.metaValue}>{formatPracticeDate(inventory.asOfDate, input.practiceTimezone)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Conducted by</Text>
          <Text style={s.metaValue}>{dash(inventory.conductedByName)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Witness</Text>
          <Text style={s.metaValue}>{dash(inventory.witnessName)}</Text>
        </View>
        {inventory.notes && (
          <>
            <Text style={[s.metaLabel, { marginTop: 4 }]}>Notes</Text>
            <Text style={s.notes}>{inventory.notes}</Text>
          </>
        )}

        {/* 4. Items table */}
        <Text style={s.sectionTitle}>Drugs Counted</Text>
        <View style={s.tHead}>
          <Text style={[s.tCellHead, s.cSchedule]}>Schedule</Text>
          <Text style={[s.tCellHead, s.cDrug]}>Drug</Text>
          <Text style={[s.tCellHead, s.cNdc]}>NDC</Text>
          <Text style={[s.tCellHead, s.cStrength]}>Strength</Text>
          <Text style={[s.tCellHead, s.cQty]}>Qty</Text>
          <Text style={[s.tCellHead, s.cUnit]}>Unit</Text>
        </View>
        {inventory.items.length === 0 ? (
          <Text style={s.emptyState}>No items recorded.</Text>
        ) : (
          inventory.items.map((it, i) => (
            <View key={i} style={s.tRow}>
              <Text style={[s.tCell, s.cSchedule]}>
                {SCHEDULE_LABELS[it.schedule] ?? it.schedule}
              </Text>
              <Text style={[s.tCell, s.cDrug]}>{it.drugName}</Text>
              <Text style={[s.tCell, s.cNdc]}>{dash(it.ndc)}</Text>
              <Text style={[s.tCell, s.cStrength]}>{dash(it.strength)}</Text>
              <Text style={[s.tCell, s.cQty]}>
                {it.quantity.toLocaleString("en-US")}
              </Text>
              <Text style={[s.tCell, s.cUnit]}>{it.unit}</Text>
            </View>
          ))
        )}

        {/* 5. Signature block */}
        <Text style={s.sectionTitle}>Signature</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Signature of registrant</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Date</Text>
          <Text style={s.metaBlank}> </Text>
        </View>

        {/* 6. Footer */}
        <Text style={s.footer} fixed>
          Generated {formatPracticeDateTime(input.generatedAt, input.practiceTimezone)} · GuardWell · Confidential
        </Text>
      </Page>
    </Document>
  );
}
