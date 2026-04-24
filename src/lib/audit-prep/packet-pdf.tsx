// src/lib/audit-prep/packet-pdf.tsx
//
// Multi-section audit-prep packet PDF. Cover page + one section per
// completed protocol. Notes are included verbatim. Evidence is rendered
// from the snapshotted JSON so the packet matches what was on screen
// when the protocol was marked complete.

import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1E293B",
  },
  coverTitle: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 6,
  },
  coverSubtitle: { fontSize: 12, color: "#64748B", marginBottom: 28 },
  meta: { fontSize: 10, color: "#475569", marginBottom: 3 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginTop: 18,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 3,
  },
  citation: {
    fontSize: 9,
    color: "#64748B",
    marginBottom: 6,
    fontStyle: "italic",
  },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  evidenceLabel: { fontSize: 9, color: "#475569", fontWeight: "bold" },
  evidenceValue: { fontSize: 10, marginLeft: 4, marginBottom: 3 },
  notesBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#F8FAFC",
    borderLeftWidth: 2,
    borderLeftColor: "#94A3B8",
    fontSize: 9,
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

export interface PacketSectionInput {
  code: string;
  title: string;
  citation: string;
  description: string;
  evidenceJson: Record<string, unknown> | null;
  notes: string | null;
  status: "COMPLETE" | "NOT_APPLICABLE";
}

export interface AuditPrepPacketInput {
  practiceName: string;
  practiceState: string;
  mode: string;
  startedAt: Date;
  generatedAt: Date;
  sections: PacketSectionInput[];
}

export function AuditPrepPacketDocument({
  input,
}: {
  input: AuditPrepPacketInput;
}) {
  return (
    <Document
      title={`${input.mode.replace(/_/g, " ")} audit-prep packet — ${input.practiceName}`}
      author="GuardWell"
      subject="Audit prep packet"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.coverTitle}>Audit-Prep Packet</Text>
        <Text style={s.coverSubtitle}>
          {input.mode.replace(/_/g, " ")} · {input.practiceName} ·{" "}
          {input.practiceState}
        </Text>
        <Text style={s.meta}>
          Started {input.startedAt.toISOString().slice(0, 10)}
        </Text>
        <Text style={s.meta}>
          Generated {input.generatedAt.toISOString().slice(0, 10)}
        </Text>
        <Text style={s.meta}>{input.sections.length} sections</Text>
        <Text style={s.footer} fixed>
          GuardWell — Audit-Prep Packet · Confidential
        </Text>
      </Page>

      {input.sections.map((sec) => (
        <Page key={sec.code} size="LETTER" style={s.page}>
          <Text style={s.sectionTitle}>
            {sec.title}{" "}
            {sec.status === "NOT_APPLICABLE" ? "(N/A)" : ""}
          </Text>
          <Text style={s.citation}>{sec.citation}</Text>
          <Text style={s.paragraph}>{sec.description}</Text>

          {sec.status === "COMPLETE" && sec.evidenceJson && (
            <View>
              <Text style={s.evidenceLabel}>Evidence snapshot</Text>
              {Object.entries(sec.evidenceJson).map(([k, v]) => (
                <Text key={k} style={s.evidenceValue}>
                  • {k}: {String(v)}
                </Text>
              ))}
            </View>
          )}

          {sec.notes && (
            <View style={s.notesBox}>
              <Text style={s.evidenceLabel}>Notes</Text>
              <Text>{sec.notes}</Text>
            </View>
          )}

          <Text style={s.footer} fixed>
            GuardWell — Audit-Prep Packet · Confidential
          </Text>
        </Page>
      ))}
    </Document>
  );
}
