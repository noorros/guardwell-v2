// src/lib/audit/credentials-register-pdf.tsx
//
// Credentials register PDF — every active credential grouped by holder
// (or "Practice-level" for org-wide credentials), with expiration
// status. Used for: state board renewals, malpractice insurance renewal,
// CMS site visits, HR audits.

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
  subtitle: { fontSize: 11, color: "#64748B", marginBottom: 18 },
  meta: { fontSize: 9, color: "#475569", marginBottom: 2 },
  holderHeader: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#1E3A5F",
    marginTop: 16,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 3,
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
  cellTitle: { width: "32%", paddingRight: 6 },
  cellNumber: { width: "20%", paddingRight: 6 },
  cellIssuer: { width: "20%", paddingRight: 6 },
  cellExpires: { width: "28%" },
  expired: { color: "#B91C1C" },
  expiringSoon: { color: "#D97706" },
  current: { color: "#15803D" },
  noExpiry: { color: "#64748B" },
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

export interface CredentialRow {
  holderLabel: string; // "Jane Smith" | "Practice-level"
  typeName: string; // "AZ MD License", etc.
  title: string;
  licenseNumber: string | null;
  issuingBody: string | null;
  issueDate: Date | null;
  expiryDate: Date | null;
}

export interface CredentialsRegisterInput {
  practiceName: string;
  practiceState: string;
  practiceTimezone: string;
  generatedAt: Date;
  credentials: CredentialRow[];
}

const SOON_MS = 60 * 24 * 60 * 60 * 1000;

function statusFor(c: CredentialRow, now: number): {
  label: string;
  style: { color?: string };
} {
  if (!c.expiryDate) return { label: "No expiry", style: s.noExpiry };
  const t = c.expiryDate.getTime();
  if (t < now) return { label: "EXPIRED", style: s.expired };
  if (t < now + SOON_MS) return { label: "Expiring soon", style: s.expiringSoon };
  return { label: "Current", style: s.current };
}

export function CredentialsRegisterDocument({
  input,
}: {
  input: CredentialsRegisterInput;
}) {
  const now = input.generatedAt.getTime();
  const expired = input.credentials.filter(
    (c) => c.expiryDate && c.expiryDate.getTime() < now,
  ).length;
  const expiringSoon = input.credentials.filter(
    (c) =>
      c.expiryDate &&
      c.expiryDate.getTime() >= now &&
      c.expiryDate.getTime() < now + SOON_MS,
  ).length;

  // Group by holder, preserving the first-occurrence order so the
  // calling route can sort once and the PDF reflects that order.
  const grouped = new Map<string, CredentialRow[]>();
  for (const c of input.credentials) {
    const arr = grouped.get(c.holderLabel) ?? [];
    arr.push(c);
    grouped.set(c.holderLabel, arr);
  }

  return (
    <Document
      title={`Credentials register — ${input.practiceName}`}
      author="GuardWell"
      subject="Credentials register"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>Credentials Register</Text>
        <Text style={s.subtitle}>
          {input.practiceName} · {input.practiceState}
        </Text>
        <Text style={s.meta}>
          Generated {formatPracticeDate(input.generatedAt, input.practiceTimezone)} ·{" "}
          {input.credentials.length} credential
          {input.credentials.length === 1 ? "" : "s"}
        </Text>
        <Text style={s.meta}>
          Status: {expired} expired · {expiringSoon} expiring within 60 days
        </Text>

        {input.credentials.length === 0 && (
          <Text style={s.emptyState}>
            No active credentials recorded. Add credentials via My Programs ›
            Credentials.
          </Text>
        )}

        {Array.from(grouped.entries()).map(([holder, rows]) => (
          <View key={holder}>
            <Text style={s.holderHeader}>{holder}</Text>
            <View style={s.rowHeader}>
              <Text style={s.cellTitle}>Credential</Text>
              <Text style={s.cellNumber}>License #</Text>
              <Text style={s.cellIssuer}>Issuer</Text>
              <Text style={s.cellExpires}>Expires</Text>
            </View>
            {rows.map((c, i) => {
              const status = statusFor(c, now);
              return (
                <View key={i} style={s.row}>
                  <Text style={s.cellTitle}>{c.title}</Text>
                  <Text style={s.cellNumber}>{c.licenseNumber ?? "—"}</Text>
                  <Text style={s.cellIssuer}>{c.issuingBody ?? "—"}</Text>
                  <Text style={[s.cellExpires, status.style]}>
                    {c.expiryDate
                      ? `${formatPracticeDate(c.expiryDate, input.practiceTimezone)} · ${status.label}`
                      : status.label}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}

        <Text style={s.footer} fixed>
          GuardWell — Credentials Register · State board, DEA, malpractice
          renewal evidence
        </Text>
      </Page>
    </Document>
  );
}
