// src/lib/audit-prep/protocols.ts
//
// Static catalog of audit-prep protocols, keyed by AuditPrepMode. Each
// ProtocolDef declares which evidence loader runs at completion + a
// human-readable "what we'll attach" summary shown in the UI.
//
// Live modes: HHS_OCR_HIPAA, OSHA. CMS/DEA still stubbed — actions.ts
// will throw at session-create if selected before the protocols ship.

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

// OSHA inspections in healthcare practices most commonly cite the
// Bloodborne Pathogens Standard (29 CFR §1910.1030), Hazard Communication
// (29 CFR §1910.1200), and Recordkeeping (29 CFR §1904) deficiencies. We
// surface 6 high-leverage protocols that map to where SMB practices
// usually have gaps.
const OSHA_PROTOCOLS: ProtocolDef[] = [
  {
    code: "OSHA_BBP_EXPOSURE_CONTROL_PLAN",
    title: "Bloodborne Pathogens Exposure Control Plan",
    citation: "29 CFR §1910.1030(c)(1)",
    description:
      "OSHA inspectors first ask for the written Exposure Control Plan. They look for an adopted plan, evidence of annual review, and that workforce training has been delivered.",
    evidenceLoaderCode: "OSHA_BBP_PLAN",
    whatWeAttach: [
      "Exposure Control Plan adoption status + date",
      "Last annual review date",
      "BBP training coverage % across workforce",
    ],
  },
  {
    code: "OSHA_HAZCOM_PROGRAM",
    title: "Hazard Communication program",
    citation: "29 CFR §1910.1200(e)",
    description:
      "OSHA verifies a written HazCom program covering chemical inventory, SDS access, and employee training. SMB practices often fail on the SDS access portion.",
    evidenceLoaderCode: "OSHA_HAZCOM",
    whatWeAttach: [
      "HazCom program adoption status",
      "HazCom training coverage % across workforce",
    ],
  },
  {
    code: "OSHA_300_LOG",
    title: "OSHA 300 Log + injury/illness recordkeeping",
    citation: "29 CFR §1904",
    description:
      "OSHA inspectors review the 300 Log for the current and prior 5 years (record retention requirement). They also look for the 300A annual summary posted Feb 1 – Apr 30 in a visible workplace location.",
    evidenceLoaderCode: "OSHA_300_LOG",
    whatWeAttach: [
      "Open Incident count tagged as recordable",
      "Total Incident count over the past year",
      "300A summary availability (manual attestation in notes)",
    ],
  },
  {
    code: "OSHA_PPE_HAZARD_ASSESSMENT",
    title: "PPE hazard assessment + training",
    citation: "29 CFR §1910.132(d)",
    description:
      "OSHA verifies a written hazard assessment that justifies the PPE selected, plus documented PPE training. Very common gap in primary care + dental.",
    evidenceLoaderCode: "OSHA_PPE",
    whatWeAttach: [
      "PPE training coverage % across workforce",
      "Bloodborne Pathogens training coverage % (PPE delivery overlap)",
    ],
  },
  {
    code: "OSHA_EMERGENCY_ACTION_PLAN",
    title: "Emergency Action Plan",
    citation: "29 CFR §1910.38",
    description:
      "OSHA looks for a written EAP covering fire/evacuation, with documented employee training. Required for any practice with more than 10 employees; encouraged for smaller.",
    evidenceLoaderCode: "OSHA_EAP",
    whatWeAttach: [
      "Emergency Action Plan policy adoption status",
      "Fire safety / evacuation training coverage %",
    ],
  },
  {
    code: "OSHA_NEEDLESTICK_LOG",
    title: "Needlestick / sharps injury log",
    citation: "29 CFR §1910.1030(h)(5)",
    description:
      "Maintained as a separate sharps injury log per the BBP standard. OSHA verifies entries include date, type, brand of device, and the work area where the incident occurred.",
    evidenceLoaderCode: "OSHA_NEEDLESTICK",
    whatWeAttach: [
      "Recent needlestick/sharps Incident count (last 12mo)",
      "Most-recent sharps incident date",
      "Sharps safety training coverage %",
    ],
  },
];

export const PROTOCOLS_BY_MODE: Record<string, ProtocolDef[]> = {
  HHS_OCR_HIPAA: HHS_OCR_HIPAA_PROTOCOLS,
  OSHA: OSHA_PROTOCOLS,
};
