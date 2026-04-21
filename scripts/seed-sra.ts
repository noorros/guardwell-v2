// scripts/seed-sra.ts
//
// Seeds the HIPAA Security Risk Assessment question bank — 20 canonical
// safeguards covering Administrative (§164.308), Physical (§164.310), and
// Technical (§164.312) controls. Ported from v1's 60+ question bank, trimmed
// for launch. Expand post-launch as customers push on gaps.
//
// Usage:
//   npm run db:seed:sra

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });

const db = new PrismaClient();

type SraCategory = "ADMINISTRATIVE" | "PHYSICAL" | "TECHNICAL";

interface QFixture {
  code: string;
  category: SraCategory;
  subcategory: string;
  title: string;
  description: string;
  guidance: string;
  lookFor: string[];
  sortOrder: number;
}

const QUESTIONS: QFixture[] = [
  // ── ADMINISTRATIVE (§164.308) ─────────────────────────────────
  {
    code: "ADMIN_RISK_ANALYSIS",
    category: "ADMINISTRATIVE",
    subcategory: "Security Management Process",
    title: "Formal risk analysis conducted",
    description:
      "Has your organization conducted a thorough, documented risk analysis of threats and vulnerabilities to ePHI confidentiality, integrity, and availability?",
    guidance:
      "OCR requires a comprehensive, organization-wide analysis. Evidence: written report documenting data flows, threat sources, existing controls, likelihood, impact. Updated annually and after significant changes.",
    lookFor: [
      "A written risk analysis document (not just a mental checklist)",
      "Inventory of every system that stores or transmits ePHI",
      "Threats identified for each system",
      "Analysis updated within the last 12 months",
      "Record of who performed and approved the analysis",
    ],
    sortOrder: 10,
  },
  {
    code: "ADMIN_RISK_MANAGEMENT",
    category: "ADMINISTRATIVE",
    subcategory: "Security Management Process",
    title: "Risk management plan implemented",
    description:
      "Do you have a documented risk management plan that addresses identified risks to an acceptable level, with owners, deadlines, and tracking?",
    guidance:
      "The plan translates risk analysis findings into action. Each identified risk should have a mitigation strategy, an owner, a target date, and a status tracker.",
    lookFor: [
      "Written plan with specific mitigation steps per risk",
      "Assigned owners (name or role) for each remediation",
      "Target dates and deadlines",
      "Status tracking showing progress",
    ],
    sortOrder: 20,
  },
  {
    code: "ADMIN_SECURITY_OFFICER",
    category: "ADMINISTRATIVE",
    subcategory: "Assigned Security Responsibility",
    title: "Security Officer designated",
    description:
      "Is a single, identifiable individual responsible for the development and implementation of HIPAA Security policies and procedures?",
    guidance:
      "§164.308(a)(2) requires a single point of accountability. Small practices can assign the role to the compliance officer, practice manager, or physician-owner, but one name must be on file.",
    lookFor: [
      "Written designation of a Security Officer (by name + date)",
      "Documented responsibilities and authority",
      "Named individual knows they hold the role",
    ],
    sortOrder: 30,
  },
  {
    code: "ADMIN_ACCESS_AUTHORIZATION",
    category: "ADMINISTRATIVE",
    subcategory: "Workforce Security",
    title: "Access authorization policy",
    description:
      "Are there documented policies governing who gets access to ePHI, at what level, and based on job role?",
    guidance:
      "Access must be role-based and documented. Each role's permissions should be predefined. New accounts follow the role's access template, not ad-hoc grants.",
    lookFor: [
      "Written policy describing role-based access",
      "Defined access levels per role",
      "Approval workflow (manager or Security Officer sign-off)",
      "Record of who approved access for each employee",
    ],
    sortOrder: 40,
  },
  {
    code: "ADMIN_TERMINATION",
    category: "ADMINISTRATIVE",
    subcategory: "Workforce Security",
    title: "Termination procedures",
    description:
      "When a workforce member leaves, are there procedures to immediately revoke access to ePHI systems, retrieve devices, and disable credentials?",
    guidance:
      "Access must be disabled on the day of departure (ideally within hours). Documented checklist covering: disable logins, revoke badges, collect equipment, forward email, archive accounts.",
    lookFor: [
      "Written termination checklist",
      "Accounts disabled by departure date for recent exits",
      "Badges/devices returned and logged",
      "Documentation per departure retained",
    ],
    sortOrder: 50,
  },
  {
    code: "ADMIN_SECURITY_TRAINING",
    category: "ADMINISTRATIVE",
    subcategory: "Security Awareness and Training",
    title: "Security awareness training",
    description:
      "Is there a periodic security awareness training program for all workforce members, including security reminders and updates on evolving threats?",
    guidance:
      "§164.308(a)(5) requires training at hire and ongoing reminders. Covers password policies, phishing, malware, physical security, incident reporting.",
    lookFor: [
      "Training content addressing each topic",
      "Documented completion per workforce member",
      "Refresh cadence (annual + as needed)",
      "Records retained per §164.530(b)(2)",
    ],
    sortOrder: 60,
  },
  {
    code: "ADMIN_INCIDENT_POLICY",
    category: "ADMINISTRATIVE",
    subcategory: "Security Incident Procedures",
    title: "Security incident response plan",
    description:
      "Do you have a documented plan for identifying, responding to, and reporting security incidents affecting ePHI?",
    guidance:
      "The plan should cover detection, containment, investigation, eradication, recovery, lessons learned. Include breach-determination workflow per §164.402.",
    lookFor: [
      "Written incident response plan",
      "Defined severity levels + escalation paths",
      "Breach-determination workflow",
      "Log of incidents with dates and resolutions",
    ],
    sortOrder: 70,
  },
  {
    code: "ADMIN_DATA_BACKUP",
    category: "ADMINISTRATIVE",
    subcategory: "Contingency Plan",
    title: "Data backup plan",
    description:
      "Is there a documented plan for backing up ePHI regularly, storing backups securely, and periodically verifying restore capability?",
    guidance:
      "Backups must be retrievable and tested. Offsite or cloud storage recommended. Encryption at rest required for backup media.",
    lookFor: [
      "Backup frequency documented (daily minimum)",
      "Offsite/cloud storage with encryption",
      "Tested restore within last 12 months",
      "Retention policy defined",
    ],
    sortOrder: 80,
  },

  // ── PHYSICAL (§164.310) ──────────────────────────────────────
  {
    code: "PHYS_FACILITY_SECURITY",
    category: "PHYSICAL",
    subcategory: "Facility Access Controls",
    title: "Facility security plan",
    description:
      "Are there physical safeguards to control access to the facility and workstations that store ePHI (locks, alarms, surveillance)?",
    guidance:
      "Locks on doors to rooms storing ePHI (server rooms, file rooms). Alarm systems or active monitoring after hours. Visitor sign-in + escort for areas with ePHI.",
    lookFor: [
      "Locks on rooms with ePHI systems",
      "Visitor log or badge system",
      "Alarm or surveillance for after-hours",
      "Written facility security plan",
    ],
    sortOrder: 100,
  },
  {
    code: "PHYS_ACCESS_CONTROL",
    category: "PHYSICAL",
    subcategory: "Facility Access Controls",
    title: "Facility access control procedures",
    description:
      "Are access controls validated — do keys/badges work only where needed, and is the key list current?",
    guidance:
      "Role-based key/badge distribution. When someone leaves, their key/badge is recovered or deactivated. Master keys secured.",
    lookFor: [
      "Current list of who has keys/badges to which doors",
      "Departed employees' keys collected",
      "Master keys secured separately",
    ],
    sortOrder: 110,
  },
  {
    code: "PHYS_WORKSTATION_SECURITY",
    category: "PHYSICAL",
    subcategory: "Workstation Use and Security",
    title: "Workstation security",
    description:
      "Are workstations positioned to prevent unauthorized viewing of ePHI, secured against theft, and locked when unattended?",
    guidance:
      "Screens positioned away from public view. Privacy filters on screens in visible areas. Cable locks on portable equipment in shared spaces. Auto-lock when unattended.",
    lookFor: [
      "Screens positioned to prevent over-the-shoulder viewing",
      "Privacy filters in public-adjacent workstations",
      "Cable locks on portable equipment",
      "Written workstation use policy",
    ],
    sortOrder: 120,
  },
  {
    code: "PHYS_MEDIA_DISPOSAL",
    category: "PHYSICAL",
    subcategory: "Device and Media Controls",
    title: "Media and device disposal",
    description:
      "Are there documented procedures for securely disposing of hardware and electronic media containing ePHI (drives, USB, paper records)?",
    guidance:
      "Physical destruction (shredding) for paper, certified wipe for drives (DoD 5220.22-M or NIST 800-88), destruction certificates retained.",
    lookFor: [
      "Written disposal procedure",
      "Certificates of destruction from shredding vendor",
      "Drive-wipe log or vendor records",
      "No ePHI-containing devices in trash (visual audit)",
    ],
    sortOrder: 130,
  },
  {
    code: "PHYS_DEVICE_INVENTORY",
    category: "PHYSICAL",
    subcategory: "Device and Media Controls",
    title: "Device inventory maintained",
    description:
      "Do you maintain a current inventory of all devices and media that store or transmit ePHI?",
    guidance:
      "Hardware + mobile + removable media. Includes make, model, serial, assigned user, encryption status. Updated when devices are added or retired.",
    lookFor: [
      "Written device inventory",
      "Coverage: workstations, laptops, phones, tablets, servers, portable media",
      "Current as of last 90 days",
      "Encryption status per device",
    ],
    sortOrder: 140,
  },

  // ── TECHNICAL (§164.312) ─────────────────────────────────────
  {
    code: "TECH_UNIQUE_USERID",
    category: "TECHNICAL",
    subcategory: "Access Control",
    title: "Unique user identification",
    description:
      "Does every workforce member have their own unique login credentials for systems containing ePHI? No shared accounts.",
    guidance:
      "§164.312(a)(2)(i) required. One account per person. Enables accountability via audit logs. Shared accounts (including 'frontdesk' / 'doctor') are a finding.",
    lookFor: [
      "User list shows one account per person",
      "No generic/shared accounts for ePHI systems",
      "Service accounts documented and reviewed",
    ],
    sortOrder: 200,
  },
  {
    code: "TECH_AUTO_LOGOFF",
    category: "TECHNICAL",
    subcategory: "Access Control",
    title: "Automatic logoff configured",
    description:
      "Are ePHI systems configured to automatically terminate sessions after a period of inactivity?",
    guidance:
      "Recommended: 10-15 minutes for workstations, shorter for shared kiosks. Documented as a system configuration setting + screensaver lock.",
    lookFor: [
      "EHR session timeout configured",
      "OS screensaver password required",
      "Reasonable timeout (≤15 minutes for most workstations)",
    ],
    sortOrder: 210,
  },
  {
    code: "TECH_ENCRYPTION_REST",
    category: "TECHNICAL",
    subcategory: "Access Control",
    title: "Encryption at rest",
    description:
      "Is ePHI stored in encrypted form on servers, workstations, laptops, and portable media?",
    guidance:
      "§164.312(a)(2)(iv) addressable — if not implemented, document why and what alternative is in place. AES-256 is the standard. Full-disk encryption on all devices.",
    lookFor: [
      "FileVault/BitLocker/LUKS on every workstation + laptop",
      "EHR vendor confirmation of at-rest encryption",
      "Encrypted backups",
      "Portable devices (phones, USB drives) encrypted",
    ],
    sortOrder: 220,
  },
  {
    code: "TECH_AUDIT_LOGGING",
    category: "TECHNICAL",
    subcategory: "Audit Controls",
    title: "Audit logs enabled",
    description:
      "Do ePHI systems generate audit logs capturing user access, modifications, and administrative actions?",
    guidance:
      "§164.312(b) required. Logs should capture: who, what, when, from where. Retention typically 6 years for HIPAA alignment.",
    lookFor: [
      "EHR audit log enabled and populated",
      "Log retention ≥6 years",
      "Logs include user ID, action, timestamp",
      "Logs protected from modification",
    ],
    sortOrder: 230,
  },
  {
    code: "TECH_DATA_INTEGRITY",
    category: "TECHNICAL",
    subcategory: "Integrity",
    title: "Data integrity controls",
    description:
      "Are there mechanisms to ensure ePHI is not improperly altered or destroyed (checksums, digital signatures, version control)?",
    guidance:
      "§164.312(c)(1) addressable. EHR systems typically handle this via versioning + audit logs. Backups validated via checksums.",
    lookFor: [
      "EHR provides version history / audit trail for records",
      "Backup integrity verified (checksum or restore test)",
      "Change management for critical systems",
    ],
    sortOrder: 240,
  },
  {
    code: "TECH_MFA",
    category: "TECHNICAL",
    subcategory: "Person or Entity Authentication",
    title: "Multi-factor authentication",
    description:
      "Is multi-factor authentication (MFA) required for all ePHI system access, especially remote access and administrative accounts?",
    guidance:
      "§164.312(d) addressable — 2026 proposed rulemaking may make this required. Best practice is MFA for all EHR and cloud access. TOTP, push, or hardware key acceptable; SMS discouraged.",
    lookFor: [
      "MFA enabled on EHR login",
      "MFA enabled on email (for PHI-containing email)",
      "MFA enabled on all remote access",
      "MFA enabled for administrative accounts",
    ],
    sortOrder: 250,
  },
  {
    code: "TECH_ENCRYPTION_TRANSIT",
    category: "TECHNICAL",
    subcategory: "Transmission Security",
    title: "Encryption in transit",
    description:
      "Is ePHI encrypted during transmission over networks (TLS, VPN for remote access, encrypted email for PHI)?",
    guidance:
      "§164.312(e)(2)(ii) addressable. TLS 1.2+ for web. VPN or Zero Trust for remote access. Encrypted email or patient portal for PHI communications.",
    lookFor: [
      "EHR accessible only via HTTPS with TLS 1.2+",
      "Remote access via VPN or Zero Trust",
      "PHI email uses encryption (S/MIME, TLS, or portal)",
      "No PHI sent via unencrypted email or fax-as-email",
    ],
    sortOrder: 260,
  },
];

async function main() {
  let upserted = 0;
  for (const q of QUESTIONS) {
    await db.sraQuestion.upsert({
      where: { code: q.code },
      update: {
        category: q.category,
        subcategory: q.subcategory,
        title: q.title,
        description: q.description,
        guidance: q.guidance,
        lookFor: q.lookFor,
        sortOrder: q.sortOrder,
      },
      create: {
        code: q.code,
        category: q.category,
        subcategory: q.subcategory,
        title: q.title,
        description: q.description,
        guidance: q.guidance,
        lookFor: q.lookFor,
        sortOrder: q.sortOrder,
      },
    });
    upserted += 1;
  }
  console.log(`Seed SRA: ${upserted} questions upserted.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
