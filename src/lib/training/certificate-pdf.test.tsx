// src/lib/training/certificate-pdf.test.tsx
//
// Unit tests for the CertificateDocument react-pdf component. Asserts
// the rendered buffer is a valid PDF (starts with `%PDF` magic bytes)
// and that optional fields (expiresAt = null) don't crash the renderer.

import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  CertificateDocument,
  type CertificateInput,
} from "./certificate-pdf";

const baseInput: CertificateInput = {
  certificateId: "test-cert-id-12345",
  practiceName: "Test Family Clinic",
  practiceTimezone: "America/Phoenix",
  employeeName: "Jane Smith",
  courseTitle: "HIPAA Basics",
  courseVersion: 1,
  completedAt: new Date("2026-04-30T17:00:00Z"),
  score: 95,
  passingScore: 80,
  expiresAt: new Date("2027-04-30T17:00:00Z"),
};

describe("CertificateDocument", () => {
  it("renders to a non-empty PDF buffer with %PDF magic bytes", async () => {
    const buffer = await renderToBuffer(
      <CertificateDocument input={baseInput} />,
    );
    expect(buffer.length).toBeGreaterThan(0);
    // PDF files start with `%PDF-` per ISO 32000.
    expect(buffer.slice(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders without crashing when expiresAt is null", async () => {
    const buffer = await renderToBuffer(
      <CertificateDocument
        input={{ ...baseInput, expiresAt: null }}
      />,
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.slice(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders with a long employee name + course title without crashing", async () => {
    const buffer = await renderToBuffer(
      <CertificateDocument
        input={{
          ...baseInput,
          employeeName:
            "Dr. Maria Catherine Elizabeth Anderson-Johnson III, MD",
          courseTitle:
            "Advanced HIPAA Privacy Rule Compliance for Healthcare Providers (Annual Refresher)",
        }}
      />,
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.slice(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders with a UTC fallback timezone", async () => {
    const buffer = await renderToBuffer(
      <CertificateDocument
        input={{ ...baseInput, practiceTimezone: "UTC" }}
      />,
    );
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.slice(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
