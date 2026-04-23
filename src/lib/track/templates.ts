// src/lib/track/templates.ts
//
// Static Track templates. Each template is an ordered list of tasks
// bucketed into target weeks (1, 2, 4, 8, 12). Tasks with
// `requirementCode` set auto-complete when the matching ComplianceItem
// flips to COMPLIANT (handled in rederiveRequirementStatus). Tasks
// without a requirementCode require explicit user click.

import type { TrackTemplateCode } from "./applicability";

export interface TrackTemplateTask {
  weekTarget: 1 | 2 | 4 | 8 | 12;
  sortOrder: number;
  title: string;
  description: string;
  href: string;
  requirementCode?: string;
}

const COMMON_WEEK_1: TrackTemplateTask[] = [
  {
    weekTarget: 1,
    sortOrder: 10,
    title: "Designate a Privacy Officer",
    description:
      "Pick the staff member who'll own HIPAA Privacy. Required by §164.530(a)(1)(i).",
    href: "/programs/staff",
    requirementCode: "HIPAA_PRIVACY_OFFICER",
  },
  {
    weekTarget: 1,
    sortOrder: 20,
    title: "Designate a Security Officer",
    description:
      "Pick the staff member who'll own HIPAA Security. Required by §164.308(a)(2). Often the same person as Privacy Officer for solo practices.",
    href: "/programs/staff",
    requirementCode: "HIPAA_SECURITY_OFFICER",
  },
  {
    weekTarget: 1,
    sortOrder: 30,
    title: "Adopt the HIPAA Notice of Privacy Practices",
    description:
      "Adopt + post your NPP. Patients receive a copy at their first visit.",
    href: "/programs/policies",
    requirementCode: "HIPAA_NPP",
  },
];

const COMMON_WEEK_2: TrackTemplateTask[] = [
  {
    weekTarget: 2,
    sortOrder: 10,
    title: "Adopt your core HIPAA policies",
    description:
      "Privacy, Security, and Breach Response policies. Required by §164.530(i)(1).",
    href: "/programs/policies",
    requirementCode: "HIPAA_POLICIES_PROCEDURES",
  },
  {
    weekTarget: 2,
    sortOrder: 20,
    title: "Have all staff complete HIPAA Basics training",
    description:
      "≥95% workforce completion required by §164.530(b)(1). Single-owner practices hit 100% after one completion.",
    href: "/programs/training",
    requirementCode: "HIPAA_WORKFORCE_TRAINING",
  },
  {
    weekTarget: 2,
    sortOrder: 30,
    title: "List your PHI vendors + execute BAAs",
    description:
      "Every active vendor that touches PHI needs a Business Associate Agreement. §164.308(b)(1).",
    href: "/programs/vendors",
    requirementCode: "HIPAA_BAAS",
  },
];

const COMMON_WEEK_4: TrackTemplateTask[] = [
  {
    weekTarget: 4,
    sortOrder: 10,
    title: "Complete your annual Security Risk Assessment",
    description:
      "HIPAA §164.308(a)(1)(ii)(A). Walks the 20-question SRA wizard; sets a fresh-for-365-days clock.",
    href: "/programs/risk",
    requirementCode: "HIPAA_SRA",
  },
  {
    weekTarget: 4,
    sortOrder: 20,
    title: "Verify staff licenses + DEA registrations are current",
    description:
      "Add credentials with expiry dates so the platform can warn you 60 days before lapse.",
    href: "/programs/credentials",
  },
];

const COMMON_WEEK_8: TrackTemplateTask[] = [
  {
    weekTarget: 8,
    sortOrder: 10,
    title: "Run your first incident-reporting drill",
    description:
      "Even a near-miss report exercises the breach-determination wizard so workforce knows the flow.",
    href: "/programs/incidents/new",
  },
  {
    weekTarget: 8,
    sortOrder: 20,
    title: "Review your Audit Overview",
    description:
      "Cross-framework readiness snapshot. Identify the 2–3 critical gaps to close before week 12.",
    href: "/audit/overview",
  },
];

const COMMON_WEEK_12: TrackTemplateTask[] = [
  {
    weekTarget: 12,
    sortOrder: 10,
    title: "Generate your compliance report",
    description:
      "Download the cross-framework PDF and review with the practice owner. Establish a recurring quarterly cadence.",
    href: "/audit/overview",
  },
  {
    weekTarget: 12,
    sortOrder: 20,
    title: "Schedule annual policy review",
    description:
      "Set a calendar reminder to revisit each policy + the SRA next year on this date.",
    href: "/programs/policies",
  },
];

export const TRACK_TEMPLATES: Record<TrackTemplateCode, TrackTemplateTask[]> = {
  GENERAL_PRIMARY_CARE: [
    ...COMMON_WEEK_1,
    ...COMMON_WEEK_2,
    ...COMMON_WEEK_4,
    ...COMMON_WEEK_8,
    ...COMMON_WEEK_12,
  ],
  DENTAL: [
    ...COMMON_WEEK_1,
    ...COMMON_WEEK_2,
    ...COMMON_WEEK_4,
    {
      weekTarget: 4,
      sortOrder: 30,
      title: "Confirm OSHA Bloodborne Pathogens compliance",
      description:
        "Dental practices have routine BBP exposure risk. Confirm exposure-control plan + annual training.",
      href: "/modules/osha",
    },
    ...COMMON_WEEK_8,
    ...COMMON_WEEK_12,
  ],
  BEHAVIORAL: [
    ...COMMON_WEEK_1,
    ...COMMON_WEEK_2,
    {
      weekTarget: 2,
      sortOrder: 40,
      title: "Document your psychotherapy notes handling",
      description:
        "Behavioral practices have stricter §164.508 authorization rules around psychotherapy notes. Document your release protocol.",
      href: "/programs/policies",
    },
    ...COMMON_WEEK_4,
    ...COMMON_WEEK_8,
    ...COMMON_WEEK_12,
  ],
  GENERIC: [
    ...COMMON_WEEK_1,
    ...COMMON_WEEK_2,
    ...COMMON_WEEK_4,
    ...COMMON_WEEK_8,
    ...COMMON_WEEK_12,
  ],
};
