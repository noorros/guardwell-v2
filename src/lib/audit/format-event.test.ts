// src/lib/audit/format-event.test.ts
import { describe, it, expect } from "vitest";
import { formatEventForActivityLog } from "./format-event";

describe("formatEventForActivityLog", () => {
  it("humanizes POLICY_ADOPTED", () => {
    const out = formatEventForActivityLog({
      type: "POLICY_ADOPTED",
      payload: { policyCode: "HIPAA_BREACH_RESPONSE_POLICY", version: 1 },
    });
    expect(out.verb).toBe("Adopted");
    expect(out.summary).toBe("HIPAA_BREACH_RESPONSE_POLICY");
    expect(out.detail).toBe("version 1");
    expect(out.icon).toBe("policy");
  });

  it("distinguishes DERIVED source on REQUIREMENT_STATUS_UPDATED", () => {
    const derived = formatEventForActivityLog({
      type: "REQUIREMENT_STATUS_UPDATED",
      payload: {
        requirementCode: "HIPAA_PRIVACY_OFFICER",
        nextStatus: "COMPLIANT",
        source: "DERIVED",
        reason: "Auto-derived from OFFICER_DESIGNATION:PRIVACY",
      },
    });
    expect(derived.verb).toBe("Auto-derived");
    expect(derived.detail).toContain("compliant");

    const user = formatEventForActivityLog({
      type: "REQUIREMENT_STATUS_UPDATED",
      payload: {
        requirementCode: "HIPAA_PRIVACY_OFFICER",
        nextStatus: "COMPLIANT",
        source: "USER",
      },
    });
    expect(user.verb).toBe("Marked");
  });

  it("flags major breach determination in the summary", () => {
    const out = formatEventForActivityLog({
      type: "INCIDENT_BREACH_DETERMINED",
      payload: {
        isBreach: true,
        overallRiskScore: 75,
      },
    });
    expect(out.summary).toBe("reportable breach");
    expect(out.detail).toBe("risk score 75/100");
  });

  it("flags not-a-breach determination", () => {
    const out = formatEventForActivityLog({
      type: "INCIDENT_BREACH_DETERMINED",
      payload: { isBreach: false, overallRiskScore: 20 },
    });
    expect(out.summary).toBe("not a breach");
  });

  it("falls back gracefully on unknown event type", () => {
    const out = formatEventForActivityLog({
      type: "SOMETHING_NEW_I_HAVENT_ADDED" as string,
      payload: {},
    });
    expect(out.icon).toBe("unknown");
    expect(out.verb).toBe("Event");
  });

  it("summarizes SRA_COMPLETED with score", () => {
    const out = formatEventForActivityLog({
      type: "SRA_COMPLETED",
      payload: {
        overallScore: 85,
        addressedCount: 17,
        totalCount: 20,
      },
    });
    expect(out.summary).toBe("Security Risk Assessment");
    expect(out.detail).toBe("85% addressed (17/20)");
  });

  it("differentiates INCIDENT_RESOLVED from INCIDENT_REPORTED", () => {
    const resolved = formatEventForActivityLog({
      type: "INCIDENT_RESOLVED",
      payload: {},
    });
    expect(resolved.verb).toBe("Resolved");
    const reported = formatEventForActivityLog({
      type: "INCIDENT_REPORTED",
      payload: { title: "Stolen laptop", type: "SECURITY", severity: "HIGH" },
    });
    expect(reported.verb).toBe("Reported");
    expect(reported.summary).toContain("Stolen laptop");
  });

  // Audit CR-3: license-number redaction in CREDENTIAL_UPSERTED detail
  it("redacts CREDENTIAL_UPSERTED licenseNumber for STAFF/VIEWER viewers", () => {
    const evt = {
      type: "CREDENTIAL_UPSERTED",
      payload: { credentialTypeCode: "DEA_NUMBER", licenseNumber: "BR1234567" },
    };
    expect(
      formatEventForActivityLog(evt, "STAFF").detail,
    ).not.toContain("BR1234567");
    expect(
      formatEventForActivityLog(evt, "VIEWER").detail,
    ).not.toContain("BR1234567");
    expect(formatEventForActivityLog(evt, "OWNER").detail).toBe("#BR1234567");
    expect(formatEventForActivityLog(evt, "ADMIN").detail).toBe("#BR1234567");
    // Default — no role passed — is treated as restricted (safe default).
    expect(formatEventForActivityLog(evt).detail).not.toContain("BR1234567");
  });
});
