// src/lib/audit-prep/protocols.ts
//
// Static catalog of audit-prep protocols, keyed by AuditPrepMode. Each
// ProtocolDef declares which evidence loader runs at completion + a
// human-readable "what we'll attach" summary shown in the UI.
//
// Live modes: HHS_OCR_HIPAA, OSHA, CMS, DEA, ALLERGY. ALLERGY added
// 2026-04-30 — closes audit #21 IM-3 (state pharmacy board inspections
// of allergen-extract compounding under USP 797 §21).

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

// CMS audits for SMB outpatient practices typically focus on provider-
// enrollment currency, emergency preparedness, billing/coding accuracy
// (Stark + AKS adherence), and the 60-day overpayment refund rule.
// CMS doesn't usually do "inspections" the way OSHA does — the most
// common touchpoint is a Medicare Administrative Contractor (MAC)
// audit triggered by claim patterns, or a Medicaid integrity audit.
const CMS_PROTOCOLS: ProtocolDef[] = [
  {
    code: "CMS_PROVIDER_ENROLLMENT",
    title: "Provider enrollment currency (NPI + PECOS + Medicare)",
    citation: "42 CFR §424.510 + §424.535",
    description:
      "CMS auditors verify that NPI, PECOS enrollment, and Medicare Provider Enrollment are all current. Stale enrollment is the leading cause of denied claims + revocation.",
    evidenceLoaderCode: "CMS_ENROLLMENT",
    whatWeAttach: [
      "NPI registration on file + expiry status",
      "PECOS enrollment on file + expiry status",
      "Medicare Provider Enrollment on file + expiry status",
    ],
  },
  {
    code: "CMS_EMERGENCY_PREPAREDNESS",
    title: "Emergency Preparedness program",
    citation: "42 CFR §482 (Hospital CoP) · §483 (LTC) · §485 (RHC)",
    description:
      "CMS-eligible providers must maintain a written Emergency Preparedness program covering risk assessment, communication plan, training, and testing exercises. Annual review required.",
    evidenceLoaderCode: "CMS_EP_PROGRAM",
    whatWeAttach: [
      "Emergency Action Plan policy adoption status",
      "Emergency preparedness training coverage % across workforce",
      "Most recent annual review date",
    ],
  },
  {
    code: "CMS_BILLING_COMPLIANCE",
    title: "Billing accuracy + Stark/AKS compliance",
    citation: "42 CFR §1001 (OIG fraud rules) · 42 USC §1395nn (Stark) · §1320a-7b (AKS)",
    description:
      "CMS Medicare Administrative Contractor (MAC) audits focus on coding accuracy, medical-necessity documentation, and arrangements that could trigger Stark or Anti-Kickback Statute concerns. Compliance Officer designation + adopted billing policy expected.",
    evidenceLoaderCode: "CMS_BILLING",
    whatWeAttach: [
      "Compliance Officer designation status",
      "OIG framework enabled?",
      "OIG compliance score",
    ],
  },
  {
    code: "CMS_OVERPAYMENT_PROCESS",
    title: "60-day overpayment refund process",
    citation: "42 USC §1320a-7k(d) (ACA §6402)",
    description:
      "Medicare overpayments must be refunded within 60 days of identification. CMS expects a documented process for surfacing, quantifying, and refunding overpayments. Failure can trigger False Claims Act liability.",
    evidenceLoaderCode: "CMS_OVERPAYMENT",
    whatWeAttach: [
      "Overpayment-refund policy adoption status",
      "Most recent policy review date",
    ],
  },
  {
    code: "CMS_PATIENT_RECORDS",
    title: "Patient encounter documentation + retention",
    citation: "42 CFR §482.24 + §483.21 (records) · State minimum",
    description:
      "CMS auditors review patient records for completeness (history, exam, medical decision-making, time documentation). Records retention typically 7+ years per state, longer in some states. CMS-specific is generally the longer of state law or 5 years post-claim.",
    evidenceLoaderCode: "CMS_RECORDS",
    whatWeAttach: [
      "Document destruction cadence: ≥1 logged in last 365 days?",
      "Records-retention policy adoption status",
    ],
  },
  {
    code: "CMS_OIG_EXCLUSION_SCREENING",
    title: "OIG exclusion screening (LEIE)",
    citation: "42 USC §1320a-7b(f) · 42 CFR §1001.1901",
    description:
      "Federal health programs cannot pay for services rendered or ordered by OIG-excluded individuals. CMS expects monthly screening of all workforce + contractors against the OIG List of Excluded Individuals/Entities (LEIE) + the GSA SAM.gov exclusion list.",
    evidenceLoaderCode: "CMS_OIG_SCREENING",
    whatWeAttach: [
      "OIG framework enabled?",
      "Active workforce count (= individuals to screen monthly)",
      "Compliance Officer designation status",
    ],
  },
];

// DEA Diversion Investigators inspect controlled-substance registrants.
// SMB practices that prescribe schedule II-V drugs are subject. Most
// common deficiencies: incomplete biennial inventory, weak physical
// security, missing prescription records, late theft/loss reports.
const DEA_PROTOCOLS: ProtocolDef[] = [
  {
    code: "DEA_REGISTRATION_CURRENCY",
    title: "DEA registration currency",
    citation: "21 CFR §1301.13",
    description:
      "DEA registration must be valid for every practitioner who prescribes, administers, or dispenses controlled substances. Registration is location-specific + drug-schedule-specific.",
    evidenceLoaderCode: "DEA_REGISTRATION",
    whatWeAttach: [
      "DEA registration credential on file + expiry status",
      "Most recent renewal date",
    ],
  },
  {
    code: "DEA_INVENTORY_RECORDKEEPING",
    title: "Biennial inventory + receipts/disposals records",
    citation: "21 CFR §1304.11 + §1304.21",
    description:
      "Initial inventory at registration + biennial inventory thereafter + ongoing records of every receipt, dispensing, administration, and disposal of controlled substances. Records kept for 2 years (5 years for Schedule II).",
    evidenceLoaderCode: "DEA_INVENTORY",
    whatWeAttach: [
      "DEA inventory + recordkeeping policy adoption status",
      "Recent controlled-substance Incident count (theft/loss/inventory discrepancies)",
    ],
  },
  {
    code: "DEA_SECURITY",
    title: "Physical security of controlled substances",
    citation: "21 CFR §1301.71-.76",
    description:
      "Controlled substances must be stored in a securely locked, substantially constructed cabinet or vault. Access limited to authorized personnel with documented hand-off. Schedule II requires more stringent storage than III-V.",
    evidenceLoaderCode: "DEA_SECURITY",
    whatWeAttach: [
      "Security Officer designation status",
      "Workstation/security policy adoption status",
      "Tracked tech assets count (PHI + general)",
    ],
  },
  {
    code: "DEA_PDMP_COMPLIANCE",
    title: "State PDMP query before prescribing",
    citation: "State-specific (e.g., FL §893.055, NY PHL §3343-A)",
    description:
      "Most states require prescribers to query the state Prescription Drug Monitoring Program (PDMP) before issuing a Schedule II prescription, often with documentation of the query in the patient chart. Federal law does not require it but state penalties apply.",
    evidenceLoaderCode: "DEA_PDMP",
    whatWeAttach: [
      "PDMP-compliance policy adoption status",
      "State PDMP-prescriber-obligations policy adoption status",
      "Practice primary state (drives which PDMP rules apply)",
    ],
  },
  {
    code: "DEA_PRESCRIPTION_RECORDS",
    title: "Prescription records + EPCS compliance",
    citation: "21 CFR §1304.04 + §1311 (EPCS)",
    description:
      "Original prescription records (paper or EPCS audit trail) must be retained 2 years (5 years for Schedule II). EPCS systems require two-factor authentication + identity-proofing per §1311.",
    evidenceLoaderCode: "DEA_PRESCRIPTIONS",
    whatWeAttach: [
      "Document destruction cadence: ≥1 logged in last 365 days?",
      "MFA-coverage % across workforce (EPCS-relevant)",
      "Active staff count",
    ],
  },
  {
    code: "DEA_THEFT_LOSS_REPORTING",
    title: "Theft/loss reporting (DEA Form 106 + 1 day)",
    citation: "21 CFR §1301.74(c) + §1301.76(b)",
    description:
      "Significant theft or loss of controlled substances must be reported to the local DEA Field Office within 1 business day of discovery, AND a written DEA Form 106 must be filed. Local police should also be notified.",
    evidenceLoaderCode: "DEA_THEFT_LOSS",
    whatWeAttach: [
      "DEA-tagged Incident count (DEA_THEFT_LOSS type)",
      "Most-recent DEA-tagged incident date",
      "Privacy Officer designation status",
    ],
  },
];

// State pharmacy board inspections of practices that compound allergen
// extracts on-site. The board typically requests evidence covering: the
// compounder roster + qualification status (USP 797 §21 component A/B/C
// per active staff member, current + 2 prior years), anaphylaxis drill
// log, equipment maintenance (emergency kit checks + refrigerator
// readings), aggregate quiz scoring, and any documented USP §21
// deviations + the corrective actions taken. Closes audit #21 IM-3.
const ALLERGY_PROTOCOLS: ProtocolDef[] = [
  {
    code: "ALLERGY_COMPOUNDER_QUALIFICATION",
    title: "Compounder roster + qualification status",
    citation: "USP 797 §21.2 (Personnel Qualifications)",
    description:
      "State pharmacy boards verify that every active compounder has documented annual qualification across the three USP §21 components: written quiz, gloved fingertip + thumb sampling, and media fill test. They typically ask for the current year plus the two prior years to confirm cadence.",
    evidenceLoaderCode: "ALLERGY_COMPOUNDER_QUALIFICATION",
    whatWeAttach: [
      "Active compounder roster (current year)",
      "Per-compounder qualification status: quiz / fingertip / media fill (current + 2 prior years)",
      "Former-staff qualification history for the same window (preserves the audit trail)",
    ],
  },
  {
    code: "ALLERGY_DRILL_LOG",
    title: "Anaphylaxis drill log",
    citation: "USP 797 §21.5 (Emergency Preparedness)",
    description:
      "Annual minimum cadence per practice. The drill log captures date, scenario, participants, duration, observations, and corrective actions. Inspectors look for ≥1 drill in the last 12 months and that participants are named individually.",
    evidenceLoaderCode: "ALLERGY_DRILL_LOG",
    whatWeAttach: [
      "Drill count in the last 12 months",
      "Most recent drill date + scenario",
      "Per-drill participant roster (with removed-staff labels preserved)",
    ],
  },
  {
    code: "ALLERGY_EQUIPMENT_LOG",
    title: "Equipment maintenance log",
    citation: "USP 797 §21.3 (Facilities & Equipment)",
    description:
      "Inspectors verify that the emergency anaphylaxis kit (epi pen + supplies) is checked monthly with expiry/lot tracking, AND that any refrigerator used to store allergen extracts is logged at the documented cadence within the 2.0–8.0 °C acceptable range.",
    evidenceLoaderCode: "ALLERGY_EQUIPMENT_LOG",
    whatWeAttach: [
      "Emergency-kit checks in the last 12 months (epi expiry + lot + items present)",
      "Refrigerator-temperature checks in the last 12 months (in-range vs out-of-range)",
      "Most recent check of each type",
    ],
  },
  {
    code: "ALLERGY_QUIZ_ATTEMPTS",
    title: "Quiz attempts + scoring",
    citation: "USP 797 §21.2 (Component A — Written Assessment)",
    description:
      "Inspectors look at aggregate pass/fail data, not individual answer keys. We surface counts, average score, and pass rate over the last 24 months. Per-attempt detail lists the staff member, date, and score — never the answer key (per audit #1 invariant).",
    evidenceLoaderCode: "ALLERGY_QUIZ_ATTEMPTS",
    whatWeAttach: [
      "Total quiz attempts in the last 24 months",
      "Pass rate + average score (aggregate, not per-question)",
      "Per-attempt: staff member + date + score (no answer-key data)",
    ],
  },
  {
    code: "ALLERGY_USP21_DEVIATIONS",
    title: "USP §21 deviations + corrective actions",
    citation: "USP 797 §21.6 (Deviation Documentation)",
    description:
      "Any deviation from the practice's compounding SOP must be documented with the corrective action taken. We surface incidents whose title or description references USP §21 / compounding / allergen, plus drills that recorded explicit corrective actions.",
    evidenceLoaderCode: "ALLERGY_USP21_DEVIATIONS",
    whatWeAttach: [
      "Allergy-tagged incident count (last 24 months) + most-recent date",
      "Drill records that captured corrective actions",
      "Open vs resolved breakdown",
    ],
  },
];

export const PROTOCOLS_BY_MODE: Record<string, ProtocolDef[]> = {
  HHS_OCR_HIPAA: HHS_OCR_HIPAA_PROTOCOLS,
  OSHA: OSHA_PROTOCOLS,
  CMS: CMS_PROTOCOLS,
  DEA: DEA_PROTOCOLS,
  ALLERGY: ALLERGY_PROTOCOLS,
};
