// src/lib/audit/dea-form-41-pdf.tsx
//
// DEA Form 41 — Registrant Inventory of Drugs Surrendered (per 21 CFR
// §1317). Documents the surrender of controlled substances to a
// DEA-registered reverse distributor or other authorized disposal
// channel.
//
// Phase C scope: this implementation renders a single-row Form 41 for
// one DeaDisposalRecord. The federal form is a multi-row table; v1
// launches single-row because most healthcare practices dispose one
// drug at a time. Future multi-drug Form 41 (renders all rows sharing
// a `disposalBatchId`) is post-launch.
//
// Hand-fillable signature blanks use the same `metaBlank` pattern as
// the OSHA 301 form so registrants can print + sign physically.

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import {
  SCHEDULE_LABELS,
  DISPOSAL_METHOD_LABELS,
} from "@/lib/dea/labels";

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
  metaLabel: { width: 160, color: "#64748B", fontSize: 9 },
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

export interface DeaForm41ItemRow {
  schedule: string;
  drugName: string;
  ndc: string | null;
  strength: string | null;
  quantity: number;
  unit: string;
}

export interface DeaForm41Input {
  practiceName: string;
  practiceState: string;
  generatedAt: Date;
  disposal: {
    disposalDate: Date;
    disposalMethod: string;
    reverseDistributorName: string;
    reverseDistributorDeaNumber: string | null;
    disposedByName: string | null;
    witnessName: string | null;
    form41Filed: boolean;
    notes: string | null;
    items: DeaForm41ItemRow[];
  };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

function methodLabel(method: string): string {
  return DISPOSAL_METHOD_LABELS[method] ?? method;
}

function scheduleLabel(s: string): string {
  return SCHEDULE_LABELS[s as keyof typeof SCHEDULE_LABELS] ?? s;
}

export function DeaForm41Document({
  input,
}: {
  input: DeaForm41Input;
}) {
  const { disposal } = input;
  return (
    <Document
      title={`DEA Form 41 — Drugs Surrendered ${formatDate(disposal.disposalDate)}`}
      author="GuardWell"
      subject="DEA Form 41 — Registrant Inventory of Drugs Surrendered (21 CFR §1317)"
    >
      <Page size="LETTER" style={s.page}>
        {/* 1. Practice header */}
        <Text style={s.practice}>
          {input.practiceName} · {input.practiceState}
        </Text>

        {/* 2. Title block */}
        <Text style={s.title}>
          DEA Form 41 — Registrant Inventory of Drugs Surrendered
        </Text>
        <Text style={s.subtitle}>21 CFR §1317</Text>

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

        {/* 4. Surrendered drugs (single-row in Phase C) */}
        <Text style={s.sectionTitle}>Drugs Surrendered</Text>
        <View style={s.tHead}>
          <Text style={[s.tCellHead, s.cSchedule]}>Schedule</Text>
          <Text style={[s.tCellHead, s.cDrug]}>Drug</Text>
          <Text style={[s.tCellHead, s.cNdc]}>NDC</Text>
          <Text style={[s.tCellHead, s.cStrength]}>Strength</Text>
          <Text style={[s.tCellHead, s.cQty]}>Qty</Text>
          <Text style={[s.tCellHead, s.cUnit]}>Unit</Text>
        </View>
        {disposal.items.map((it, i) => (
          <View key={i} style={s.tRow}>
            <Text style={[s.tCell, s.cSchedule]}>
              {scheduleLabel(it.schedule)}
            </Text>
            <Text style={[s.tCell, s.cDrug]}>{it.drugName}</Text>
            <Text style={[s.tCell, s.cNdc]}>{dash(it.ndc)}</Text>
            <Text style={[s.tCell, s.cStrength]}>{dash(it.strength)}</Text>
            <Text style={[s.tCell, s.cQty]}>
              {it.quantity.toLocaleString("en-US")}
            </Text>
            <Text style={[s.tCell, s.cUnit]}>{it.unit}</Text>
          </View>
        ))}

        {/* 5. Reverse distributor + disposal method */}
        <Text style={s.sectionTitle}>Disposal</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Disposal date</Text>
          <Text style={s.metaValue}>{formatDate(disposal.disposalDate)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Disposal method</Text>
          <Text style={s.metaValue}>{methodLabel(disposal.disposalMethod)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Reverse distributor</Text>
          <Text style={s.metaValue}>{disposal.reverseDistributorName}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Reverse distributor DEA #</Text>
          <Text style={s.metaValue}>
            {dash(disposal.reverseDistributorDeaNumber)}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Form 41 filed with DEA</Text>
          <Text style={s.metaValue}>
            {disposal.form41Filed ? "Yes" : "No"}
          </Text>
        </View>
        {disposal.notes && (
          <>
            <Text style={[s.metaLabel, { marginTop: 4 }]}>Notes</Text>
            <Text style={s.notes}>{disposal.notes}</Text>
          </>
        )}

        {/* 6. Witness signature block */}
        <Text style={s.sectionTitle}>Signatures</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Disposed by</Text>
          <Text style={s.metaValue}>{dash(disposal.disposedByName)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Signature of registrant</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Date</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Witness</Text>
          <Text style={s.metaValue}>{dash(disposal.witnessName)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Signature of witness</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Date</Text>
          <Text style={s.metaBlank}> </Text>
        </View>

        {/* 7. Footer */}
        <Text style={s.footer} fixed>
          Generated {formatDateTime(input.generatedAt)} · GuardWell · Confidential
        </Text>
      </Page>
    </Document>
  );
}
