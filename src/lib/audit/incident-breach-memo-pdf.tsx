// src/lib/audit/incident-breach-memo-pdf.tsx
//
// HIPAA §164.402 breach determination memo PDF — single incident,
// substantive analysis. Generated when the practice needs to surface
// the documented breach decision to OCR auditors, board, or
// state attorney general per individual notification rules.

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
  practice: {
    fontSize: 9,
    color: "#64748B",
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 4,
  },
  incidentTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 3,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  metaLabel: {
    width: 130,
    color: "#64748B",
    fontSize: 9,
  },
  metaValue: {
    flex: 1,
    fontSize: 10,
    color: "#1E293B",
  },
  factorBlock: {
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  factorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  factorTitle: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#1E3A5F",
  },
  factorScore: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#1E3A5F",
  },
  factorDesc: {
    fontSize: 9,
    color: "#475569",
    lineHeight: 1.4,
  },
  decisionBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
  },
  decisionBreach: {
    backgroundColor: "#FEF2F2",
    borderColor: "#B91C1C",
  },
  decisionNotBreach: {
    backgroundColor: "#F0FDF4",
    borderColor: "#15803D",
  },
  decisionLabel: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 4,
  },
  decisionLabelBreach: { color: "#B91C1C" },
  decisionLabelNotBreach: { color: "#15803D" },
  decisionDetail: {
    fontSize: 9,
    color: "#475569",
    lineHeight: 1.4,
  },
  memoBody: {
    fontSize: 10,
    color: "#1E293B",
    lineHeight: 1.5,
  },
  notifRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  notifLabel: {
    width: 180,
    fontSize: 9,
    color: "#475569",
  },
  notifValue: {
    flex: 1,
    fontSize: 9,
    color: "#1E293B",
  },
  notifPending: {
    flex: 1,
    fontSize: 9,
    color: "#D97706",
    fontStyle: "italic",
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

const FACTOR_DESCRIPTIONS: ReadonlyArray<{ title: string; desc: string }> = [
  {
    title: "Factor 1 — Nature and extent of PHI involved",
    desc: "Includes the types of identifiers (e.g. SSN, financial account, clinical detail) and the likelihood the information could be used to re-identify or harm the individual.",
  },
  {
    title: "Factor 2 — Unauthorized person who used or received the PHI",
    desc: "Considers whether the recipient is bound by HIPAA or another confidentiality obligation. A recipient inside the workforce of another covered entity is lower-risk than an unrelated external party.",
  },
  {
    title: "Factor 3 — Whether PHI was actually acquired or viewed",
    desc: "Forensic evidence of access (logs, recipient confirmation, recovered media) vs. mere opportunity for access. Mailings returned unopened weigh lower; confirmed reads weigh higher.",
  },
  {
    title: "Factor 4 — Extent to which the risk to the PHI has been mitigated",
    desc: "Includes assurances from the recipient (e.g. signed destruction certification), recovered devices, password resets, and other corrective actions that reduce the probability of misuse.",
  },
];

export interface BreachMemoNotification {
  ocrNotifiedAt: Date | null;
  affectedIndividualsNotifiedAt: Date | null;
  mediaNotifiedAt: Date | null;
  stateAgNotifiedAt: Date | null;
}

export interface BreachMemoInput {
  practiceName: string;
  practiceState: string;
  practiceTimezone: string;
  generatedAt: Date;
  incident: {
    title: string;
    type: string;
    severity: string;
    discoveredAt: Date;
    phiInvolved: boolean;
    patientState: string | null;
    affectedCount: number | null;
    factor1Score: number;
    factor2Score: number;
    factor3Score: number;
    factor4Score: number;
    overallRiskScore: number;
    isBreach: boolean;
    ocrNotifyRequired: boolean;
    breachDeterminationMemo: string | null;
    breachDeterminedAt: Date;
  };
  notifications: BreachMemoNotification;
}

const TYPE_LABELS: Record<string, string> = {
  PRIVACY: "Privacy",
  SECURITY: "Security",
  OSHA_RECORDABLE: "OSHA recordable",
  NEAR_MISS: "Near miss",
  DEA_THEFT_LOSS: "DEA theft/loss",
  CLIA_QC_FAILURE: "CLIA QC failure",
  TCPA_COMPLAINT: "TCPA complaint",
};


export function IncidentBreachMemoDocument({
  input,
}: {
  input: BreachMemoInput;
}) {
  const { incident, notifications } = input;
  const factors = [
    incident.factor1Score,
    incident.factor2Score,
    incident.factor3Score,
    incident.factor4Score,
  ];
  const isMajor = (incident.affectedCount ?? 0) >= 500;

  return (
    <Document
      title={`Breach Determination Memo — ${incident.title}`}
      author="GuardWell"
      subject="HIPAA §164.402 breach determination"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.practice}>
          {input.practiceName} · {input.practiceState}
        </Text>
        <Text style={s.title}>HIPAA §164.402 Breach Determination Memo</Text>
        <Text style={s.incidentTitle}>{incident.title}</Text>

        <Text style={s.sectionTitle}>Incident Summary</Text>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Discovered</Text>
          <Text style={s.metaValue}>{formatPracticeDate(incident.discoveredAt, input.practiceTimezone)}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Determination recorded</Text>
          <Text style={s.metaValue}>
            {formatPracticeDate(incident.breachDeterminedAt, input.practiceTimezone)}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Type</Text>
          <Text style={s.metaValue}>
            {TYPE_LABELS[incident.type] ?? incident.type}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Severity</Text>
          <Text style={s.metaValue}>{incident.severity}</Text>
        </View>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>PHI involved</Text>
          <Text style={s.metaValue}>{incident.phiInvolved ? "Yes" : "No"}</Text>
        </View>
        {incident.patientState && (
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>Patient state</Text>
            <Text style={s.metaValue}>{incident.patientState}</Text>
          </View>
        )}
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>Affected individuals</Text>
          <Text style={s.metaValue}>
            {incident.affectedCount === null
              ? "Unknown"
              : incident.affectedCount.toLocaleString("en-US")}
            {isMajor ? "  (Major breach — ≥500)" : ""}
          </Text>
        </View>

        <Text style={s.sectionTitle}>Four-Factor Risk Analysis</Text>
        {FACTOR_DESCRIPTIONS.map((f, i) => (
          <View key={i} style={s.factorBlock}>
            <View style={s.factorHeader}>
              <Text style={s.factorTitle}>{f.title}</Text>
              <Text style={s.factorScore}>{factors[i]} / 5</Text>
            </View>
            <Text style={s.factorDesc}>{f.desc}</Text>
          </View>
        ))}

        <View
          style={[
            s.decisionBox,
            incident.isBreach ? s.decisionBreach : s.decisionNotBreach,
          ]}
        >
          <Text
            style={[
              s.decisionLabel,
              incident.isBreach
                ? s.decisionLabelBreach
                : s.decisionLabelNotBreach,
            ]}
          >
            {incident.isBreach
              ? "Determination: Reportable Breach"
              : "Determination: Not a Reportable Breach"}
          </Text>
          <Text style={s.decisionDetail}>
            Composite risk score: {incident.overallRiskScore} / 100.{" "}
            {incident.isBreach
              ? incident.ocrNotifyRequired
                ? "HHS OCR notification required within 60 days of discovery."
                : "OCR notification not required."
              : "Low probability that PHI was compromised."}
          </Text>
        </View>

        <Text style={s.sectionTitle}>Documented Analysis</Text>
        <Text style={s.memoBody}>
          {incident.breachDeterminationMemo ??
            "(No memo recorded with this determination.)"}
        </Text>

        <Text style={s.sectionTitle}>Notification Timeline</Text>
        <NotifRow
          label="HHS Office for Civil Rights"
          notifiedAt={notifications.ocrNotifiedAt}
          required={incident.isBreach && incident.ocrNotifyRequired}
          timezone={input.practiceTimezone}
        />
        <NotifRow
          label="Affected individuals"
          notifiedAt={notifications.affectedIndividualsNotifiedAt}
          required={incident.isBreach}
          timezone={input.practiceTimezone}
        />
        <NotifRow
          label="Media (≥500 affected)"
          notifiedAt={notifications.mediaNotifiedAt}
          required={incident.isBreach && isMajor}
          timezone={input.practiceTimezone}
        />
        <NotifRow
          label="State Attorney General"
          notifiedAt={notifications.stateAgNotifiedAt}
          required={incident.isBreach}
          timezone={input.practiceTimezone}
        />

        <Text style={s.footer} fixed>
          Generated {formatPracticeDateTime(input.generatedAt, input.practiceTimezone)} · GuardWell · Confidential
        </Text>
      </Page>
    </Document>
  );
}

function NotifRow({
  label,
  notifiedAt,
  required,
  timezone,
}: {
  label: string;
  notifiedAt: Date | null;
  required: boolean;
  timezone: string;
}) {
  const value = notifiedAt
    ? `Notified ${formatPracticeDate(notifiedAt, timezone)}`
    : required
      ? "Not yet notified"
      : "Not required";
  const styleLine =
    !notifiedAt && required ? s.notifPending : s.notifValue;
  return (
    <View style={s.notifRow}>
      <Text style={s.notifLabel}>{label}</Text>
      <Text style={styleLine}>{value}</Text>
    </View>
  );
}
