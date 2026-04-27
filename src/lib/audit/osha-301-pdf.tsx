// src/lib/audit/osha-301-pdf.tsx
//
// OSHA Form 301 — Injury and Illness Incident Report (per 29 CFR §1904.7).
// Single-incident narrative filed alongside the OSHA 300 log. The federal
// form has 5 sections; v2 captures sections 3-5 from incident data.
// Sections 1 (employee) and 2 (physician) render as fillable boxes a
// Privacy Officer can hand-fill before submission to OSHA — the schema
// doesn't store employee SSN, DOB, or physician info by design.

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
  hint: {
    fontSize: 8,
    color: "#94A3B8",
    fontStyle: "italic",
    marginBottom: 6,
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
  narrative: { fontSize: 10, color: "#1E293B", lineHeight: 1.5 },
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

const OUTCOME_LABELS: Record<string, string> = {
  DEATH: "Death",
  DAYS_AWAY: "Days away from work",
  RESTRICTED: "Job transfer or restriction",
  OTHER_RECORDABLE: "Other recordable case",
  FIRST_AID: "First aid only",
};

export interface Osha301Input {
  practiceName: string;
  practiceState: string;
  generatedAt: Date;
  incident: {
    title: string;
    description: string;
    discoveredAt: Date;
    oshaBodyPart: string | null;
    oshaInjuryNature: string | null;
    oshaOutcome: string | null;
    oshaDaysAway: number | null;
    oshaDaysRestricted: number | null;
    sharpsDeviceType: string | null;
  };
  reportedByName: string | null;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function blank(value: string | null | undefined): string {
  return value && value.trim() ? value : "                                  ";
}

export function Osha301Document({ input }: { input: Osha301Input }) {
  const { incident } = input;
  return (
    <Document
      title={`OSHA 301 — ${incident.title}`}
      author="GuardWell"
      subject="OSHA Form 301 Injury and Illness Incident Report"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.practice}>
          {input.practiceName} · {input.practiceState}
        </Text>
        <Text style={s.title}>OSHA Form 301</Text>
        <Text style={s.subtitle}>Injury and Illness Incident Report — 29 CFR §1904.7</Text>

        {/* Section 1: Employee */}
        <Text style={s.sectionTitle}>1. Employee Information</Text>
        <Text style={s.hint}>
          Sections 1 and 2 are not stored in GuardWell. Print and complete by hand
          before filing with OSHA.
        </Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Reported by</Text>
          <Text style={s.metaValue}>{blank(input.reportedByName)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Full name</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Address</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Date of birth</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Date hired</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Job title</Text>
          <Text style={s.metaBlank}> </Text>
        </View>

        {/* Section 2: Physician */}
        <Text style={s.sectionTitle}>2. Physician / Health-Care Professional</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Name</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Facility</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Treatment given</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Hospitalized overnight?</Text>
          <Text style={s.metaBlank}> </Text>
        </View>

        {/* Section 3: Incident description */}
        <Text style={s.sectionTitle}>3. Incident Description</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Date of injury</Text>
          <Text style={s.metaValue}>{formatDate(incident.discoveredAt)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Title</Text>
          <Text style={s.metaValue}>{incident.title}</Text>
        </View>
        <Text style={[s.metaLabel, { marginTop: 4 }]}>What happened</Text>
        <Text style={s.narrative}>{incident.description}</Text>

        {/* Section 4: Injury detail */}
        <Text style={s.sectionTitle}>4. Injury / Illness Detail</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Body part affected</Text>
          <Text style={s.metaValue}>{blank(incident.oshaBodyPart)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Nature of injury</Text>
          <Text style={s.metaValue}>{blank(incident.oshaInjuryNature)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Outcome</Text>
          <Text style={s.metaValue}>
            {incident.oshaOutcome
              ? OUTCOME_LABELS[incident.oshaOutcome] ?? incident.oshaOutcome
              : "—"}
          </Text>
        </View>
        {incident.oshaDaysAway != null && (
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>Days away from work</Text>
            <Text style={s.metaValue}>{incident.oshaDaysAway}</Text>
          </View>
        )}
        {incident.oshaDaysRestricted != null && (
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>Days on restricted duty</Text>
            <Text style={s.metaValue}>{incident.oshaDaysRestricted}</Text>
          </View>
        )}
        {incident.sharpsDeviceType && (
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>Sharps device</Text>
            <Text style={s.metaValue}>{incident.sharpsDeviceType}</Text>
          </View>
        )}

        {/* Section 5: Signature */}
        <Text style={s.sectionTitle}>5. Signature</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Signed by</Text>
          <Text style={s.metaBlank}> </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Date</Text>
          <Text style={s.metaBlank}> </Text>
        </View>

        <Text style={s.footer} fixed>
          Generated {formatDate(input.generatedAt)} · OSHA Form 301 · GuardWell
        </Text>
      </Page>
    </Document>
  );
}
