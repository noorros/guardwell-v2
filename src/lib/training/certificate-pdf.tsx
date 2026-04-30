// src/lib/training/certificate-pdf.tsx
//
// Phase 4 PR 7 — Single-page Certificate of Completion PDF rendered with
// @react-pdf/renderer. Issued for every passing TrainingCompletion.
//
// Audit-defense intent: a regulator (HIPAA §164.308(a)(5)(i), OSHA training
// recordkeeping, state board CE) can ask a clinic for proof that a named
// employee completed a specific course on a specific date. This certificate
// IS that proof — practice name, employee name, course title + version
// (so retraining triggered by curriculum updates is visible), completion
// date in the practice's timezone, score, expiry, and a unique
// certificate ID == TrainingCompletion.id for cross-reference into the
// audit trail event log.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { formatPracticeDate } from "@/lib/audit/format";

export interface CertificateInput {
  certificateId: string; // = TrainingCompletion.id
  practiceName: string;
  practiceTimezone: string;
  employeeName: string;
  courseTitle: string;
  courseVersion: number;
  completedAt: Date;
  score: number;
  passingScore: number;
  expiresAt: Date | null;
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 60,
    fontFamily: "Helvetica",
  },
  border: {
    borderWidth: 4,
    borderColor: "#0B5394",
    borderRadius: 8,
    padding: 40,
    height: "100%",
  },
  brand: {
    fontSize: 14,
    color: "#0B5394",
    textAlign: "center",
    marginBottom: 20,
    fontFamily: "Helvetica-Bold",
  },
  title: {
    fontSize: 28,
    color: "#1F2937",
    textAlign: "center",
    marginBottom: 30,
    fontFamily: "Helvetica-Bold",
  },
  awardedTo: {
    fontSize: 12,
    color: "#6B7280",
    textAlign: "center",
    marginBottom: 10,
  },
  employeeName: {
    fontSize: 24,
    color: "#1F2937",
    textAlign: "center",
    marginBottom: 30,
    fontFamily: "Helvetica-Bold",
  },
  body: {
    fontSize: 12,
    color: "#1F2937",
    textAlign: "center",
    marginBottom: 8,
    lineHeight: 1.5,
  },
  course: {
    fontSize: 16,
    color: "#0B5394",
    textAlign: "center",
    marginVertical: 16,
    fontFamily: "Helvetica-Bold",
  },
  meta: {
    fontSize: 10,
    color: "#6B7280",
    textAlign: "center",
    marginTop: 30,
  },
  certId: {
    fontSize: 8,
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 40,
    fontFamily: "Courier",
  },
});

export function CertificateDocument({ input }: { input: CertificateInput }) {
  const completedFormatted = formatPracticeDate(
    input.completedAt,
    input.practiceTimezone,
  );
  const expiresFormatted = input.expiresAt
    ? formatPracticeDate(input.expiresAt, input.practiceTimezone)
    : null;

  return (
    <Document title={`Certificate of Completion - ${input.courseTitle}`}>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.border}>
          <Text style={styles.brand}>{input.practiceName}</Text>
          <Text style={styles.title}>Certificate of Completion</Text>
          <Text style={styles.awardedTo}>Awarded to</Text>
          <Text style={styles.employeeName}>{input.employeeName}</Text>
          <Text style={styles.body}>For successfully completing</Text>
          <Text style={styles.course}>
            {input.courseTitle} (v{input.courseVersion})
          </Text>
          <Text style={styles.body}>
            Completed on {completedFormatted} with a score of {input.score}%
            (passing {input.passingScore}%).
          </Text>
          {expiresFormatted && (
            <Text style={styles.body}>
              This certificate expires {expiresFormatted}.
            </Text>
          )}
          <Text style={styles.meta}>Issued by GuardWell Compliance</Text>
          <Text style={styles.certId}>
            Certificate ID: {input.certificateId}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
