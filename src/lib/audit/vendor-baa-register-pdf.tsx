// src/lib/audit/vendor-baa-register-pdf.tsx
//
// Vendor + BAA register PDF — every active vendor with their service
// description, BAA status, expiration window. Used for: HIPAA audit
// response (the §164.502(e) BA contracts requirement), board reviews,
// outside-counsel due diligence on PHI flow.

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
  cellName: { width: "28%", paddingRight: 6 },
  cellService: { width: "32%", paddingRight: 6 },
  cellBaa: { width: "20%", paddingRight: 6 },
  cellExpires: { width: "20%" },
  expired: { color: "#B91C1C" },
  expiringSoon: { color: "#D97706" },
  current: { color: "#15803D" },
  noBaa: { color: "#B91C1C", fontStyle: "italic" },
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

export interface VendorRow {
  name: string;
  type: string | null;
  service: string | null;
  processesPhi: boolean;
  baaDirection: string | null;
  baaExecutedAt: Date | null;
  baaExpiresAt: Date | null;
}

export interface VendorBaaRegisterInput {
  practiceName: string;
  practiceState: string;
  practiceTimezone: string;
  generatedAt: Date;
  vendors: VendorRow[];
}

const SOON_MS = 60 * 24 * 60 * 60 * 1000;

function statusFor(v: VendorRow, now: number): {
  label: string;
  style: { color?: string; fontStyle?: "italic" };
} {
  if (!v.processesPhi) {
    return { label: "BAA not required", style: { color: "#64748B" } };
  }
  if (!v.baaExecutedAt) {
    return { label: "MISSING BAA", style: s.noBaa };
  }
  if (!v.baaExpiresAt) {
    return { label: "Executed (no expiry)", style: s.current };
  }
  const t = v.baaExpiresAt.getTime();
  if (t < now) return { label: "EXPIRED", style: s.expired };
  if (t < now + SOON_MS) return { label: "Expiring soon", style: s.expiringSoon };
  return { label: "Current", style: s.current };
}

export function VendorBaaRegisterDocument({
  input,
}: {
  input: VendorBaaRegisterInput;
}) {
  const now = input.generatedAt.getTime();
  const phiVendors = input.vendors.filter((v) => v.processesPhi);
  const otherVendors = input.vendors.filter((v) => !v.processesPhi);

  const missing = phiVendors.filter((v) => !v.baaExecutedAt).length;
  const expired = phiVendors.filter(
    (v) => v.baaExecutedAt && v.baaExpiresAt && v.baaExpiresAt.getTime() < now,
  ).length;
  const expiringSoon = phiVendors.filter(
    (v) =>
      v.baaExecutedAt &&
      v.baaExpiresAt &&
      v.baaExpiresAt.getTime() >= now &&
      v.baaExpiresAt.getTime() < now + SOON_MS,
  ).length;

  return (
    <Document
      title={`Vendor + BAA register — ${input.practiceName}`}
      author="GuardWell"
      subject="Vendor + BAA register"
    >
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>Vendor + BAA Register</Text>
        <Text style={s.subtitle}>
          {input.practiceName} · {input.practiceState}
        </Text>
        <Text style={s.meta}>
          Generated {formatPracticeDate(input.generatedAt, input.practiceTimezone)} ·{" "}
          {input.vendors.length} vendor{input.vendors.length === 1 ? "" : "s"} ·{" "}
          {phiVendors.length} processes PHI
        </Text>
        <Text style={s.meta}>
          BAA status (PHI vendors): {missing} missing · {expired} expired ·{" "}
          {expiringSoon} expiring within 60 days
        </Text>

        {phiVendors.length > 0 ? (
          <>
            <Text style={s.sectionTitle}>PHI vendors — BAA required</Text>
            <SectionTable rows={phiVendors} now={now} timezone={input.practiceTimezone} />
          </>
        ) : (
          <>
            <Text style={s.sectionTitle}>PHI vendors — BAA required</Text>
            <Text style={s.emptyState}>
              No vendors are flagged as processing PHI. Confirm that this is
              accurate before relying on this for an audit response.
            </Text>
          </>
        )}

        {otherVendors.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Non-PHI vendors</Text>
            <SectionTable rows={otherVendors} now={now} timezone={input.practiceTimezone} />
          </>
        )}

        {input.vendors.length === 0 && (
          <Text style={s.emptyState}>
            No vendors recorded yet. Add vendors via My Programs › Vendors.
          </Text>
        )}

        <Text style={s.footer} fixed>
          GuardWell — Vendor + BAA Register · §164.502(e) Business Associate
          contracts evidence
        </Text>
      </Page>
    </Document>
  );
}

function SectionTable({ rows, now, timezone }: { rows: VendorRow[]; now: number; timezone: string }) {
  return (
    <View>
      <View style={s.rowHeader}>
        <Text style={s.cellName}>Vendor</Text>
        <Text style={s.cellService}>Service</Text>
        <Text style={s.cellBaa}>BAA executed</Text>
        <Text style={s.cellExpires}>Status</Text>
      </View>
      {rows.map((v, i) => {
        const status = statusFor(v, now);
        return (
          <View key={i} style={s.row}>
            <Text style={s.cellName}>
              {v.name}
              {v.type ? ` (${v.type})` : ""}
            </Text>
            <Text style={s.cellService}>{v.service ?? "—"}</Text>
            <Text style={s.cellBaa}>
              {v.baaExecutedAt
                ? formatPracticeDate(v.baaExecutedAt, timezone)
                : "—"}
            </Text>
            <Text style={[s.cellExpires, status.style]}>{status.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
