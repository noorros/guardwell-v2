// src/lib/audit-prep/protocols.ts
//
// Static catalog of audit-prep protocols, keyed by AuditPrepMode. Each
// ProtocolDef declares which evidence loader runs at completion + a
// human-readable "what we'll attach" summary shown in the UI.
//
// MVP: only HHS_OCR_HIPAA is registered. OSHA/CMS/DEA are stubbed out
// to throw at session creation if selected — that prevents accidental
// activation before the protocols are filled in.

export interface ProtocolDef {
  code: string;
  title: string;
  citation: string;
  description: string;
  evidenceLoaderCode: string;
  whatWeAttach: string[];
}

const HHS_OCR_HIPAA_PROTOCOLS: ProtocolDef[] = [
  {
    code: "NPP_DELIVERY",
    title: "Notice of Privacy Practices delivery",
    citation: "45 CFR §164.520",
    description:
      "OCR auditors verify that the practice has adopted, posted, and provided the NPP. They look for: a current adopted version, a posting strategy, and acknowledgment from new patients.",
    evidenceLoaderCode: "NPP_DELIVERY",
    whatWeAttach: [
      "NPP adoption status + date",
      "Last review date (annual review cadence)",
      "Adopted version number",
    ],
  },
  {
    code: "WORKFORCE_TRAINING",
    title: "Workforce HIPAA training",
    citation: "45 CFR §164.530(b)(1)",
    description:
      "OCR verifies that all workforce members have completed HIPAA training. Look for ≥95% coverage, with completions within the last 12 months.",
    evidenceLoaderCode: "WORKFORCE_TRAINING",
    whatWeAttach: [
      "Active staff count",
      "HIPAA Basics completion count + coverage %",
      "Completions expiring within 60 days",
    ],
  },
  {
    code: "RISK_ANALYSIS",
    title: "Security Risk Analysis (SRA)",
    citation: "45 CFR §164.308(a)(1)(ii)(A)",
    description:
      "OCR's most-cited finding is missing or stale risk analysis. Look for a completed SRA within the last 12 months AND an asset inventory that identifies PHI-processing systems.",
    evidenceLoaderCode: "RISK_ANALYSIS",
    whatWeAttach: [
      "Latest SRA completion date + score",
      "SRA freshness (within 365 days?)",
      "PHI-processing asset count",
    ],
  },
  {
    code: "RISK_MANAGEMENT",
    title: "Risk management + incident response",
    citation: "45 CFR §164.308(a)(1)(ii)(B) + §164.308(a)(6)",
    description:
      "OCR verifies that identified risks are tracked through resolution. Look for an incident log + breach determinations + resolution evidence.",
    evidenceLoaderCode: "RISK_MANAGEMENT",
    whatWeAttach: [
      "Unresolved breach count",
      "Open incident count (open + under investigation)",
      "Resolved breach count (historical)",
    ],
  },
  {
    code: "SANCTIONS_POLICY",
    title: "Sanctions policy + exclusion screening",
    citation: "45 CFR §164.530(e) + 42 CFR §1003 (OIG)",
    description:
      "OCR + OIG verify that the practice has a sanctions policy for workforce violations + screens against the federal exclusion list. Look for a designated Privacy Officer + OIG framework adoption.",
    evidenceLoaderCode: "SANCTIONS_POLICY",
    whatWeAttach: [
      "Privacy Officer designation status",
      "OIG framework enabled?",
      "OIG compliance score",
    ],
  },
  {
    code: "CONTINGENCY_PLAN",
    title: "Contingency plan + breach response",
    citation: "45 CFR §164.308(a)(7)",
    description:
      "OCR verifies that the practice can respond to system disruption + a breach. Look for a Breach Response policy + an asset inventory with encryption status.",
    evidenceLoaderCode: "CONTINGENCY_PLAN",
    whatWeAttach: [
      "Breach Response policy adoption status",
      "Total tracked assets",
      "PHI assets with encryption coverage",
    ],
  },
];

export const PROTOCOLS_BY_MODE: Record<string, ProtocolDef[]> = {
  HHS_OCR_HIPAA: HHS_OCR_HIPAA_PROTOCOLS,
};
