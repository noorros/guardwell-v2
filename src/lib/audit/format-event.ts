// src/lib/audit/format-event.ts
//
// Turns an EventLog row into a human-readable activity entry. One
// formatter per event type; falls back to a generic "<Event type>" when
// a new type hasn't been wired yet so adding events doesn't break the
// activity log. Pure — no DB calls.
//
// Usage:
//   const { verb, summary, detail } = formatEventForActivityLog(evt, viewerRole);
//   // verb:    "Adopted"              — short action label (for a badge)
//   // summary: "HIPAA Privacy Policy" — target of the action
//   // detail:  "version 1"            — optional supporting line
//
// `viewerRole` is the role of the user looking at the activity log —
// passed in so the formatter can redact PII (e.g. credential license
// numbers in CREDENTIAL_UPSERTED detail) for STAFF/VIEWER while still
// showing them the audit-trail entries themselves. OWNER/ADMIN see the
// full detail. Audit CR-3 (2026-04-30).

import type { EventType } from "@/lib/events/registry";
import type { PracticeRole } from "@prisma/client";

export interface ActivityEntry {
  /** Icon hint ("policy" | "training" | "incident" | ...) for UI rendering. */
  icon: ActivityIcon;
  /** Past-tense verb shown in the activity badge. */
  verb: string;
  /** Primary target of the action — requirement code, policy name, etc. */
  summary: string;
  /** Optional supporting line (score, source, delta). */
  detail: string | null;
}

export type ActivityIcon =
  | "practice"
  | "user"
  | "requirement"
  | "officer"
  | "policy"
  | "training"
  | "vendor"
  | "credential"
  | "sra"
  | "incident"
  | "unknown";

type AnyPayload = Record<string, unknown>;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export function formatEventForActivityLog(
  evt: {
    type: string;
    payload: unknown;
  },
  viewerRole?: PracticeRole | null,
): ActivityEntry {
  const type = evt.type as EventType;
  const p = (evt.payload ?? {}) as AnyPayload;
  // Audit CR-3: STAFF/VIEWER must not see PII in the activity-log
  // detail (e.g. license numbers exposed via CREDENTIAL_UPSERTED). The
  // entry itself stays visible so they retain audit-trail visibility,
  // but the sensitive fields are redacted unless the viewer is at
  // least ADMIN. `viewerRole` undefined or null is treated as STAFF
  // for safety (formatter is also used by the SDK / tests).
  const canSeeFullDetail = viewerRole === "OWNER" || viewerRole === "ADMIN";

  switch (type) {
    case "PRACTICE_CREATED":
      return {
        icon: "practice",
        verb: "Created",
        summary: `practice "${str(p.practiceName, "unnamed")}"`,
        detail: `primary state ${str(p.primaryState, "—")}`,
      };

    case "USER_INVITED":
      return {
        icon: "user",
        verb: "Invited",
        summary: str(p.invitedEmail, "team member"),
        detail: `role ${str(p.role, "STAFF")}`,
      };

    case "REQUIREMENT_STATUS_UPDATED": {
      const source = str(p.source);
      const nextStatus = str(p.nextStatus, "UPDATED");
      const code = str(p.requirementCode, "requirement");
      const verb =
        source === "DERIVED"
          ? "Auto-derived"
          : source === "AI_ASSESSMENT"
            ? "AI-scored"
            : source === "IMPORT"
              ? "Imported"
              : "Marked";
      return {
        icon: "requirement",
        verb,
        summary: code,
        detail: `${nextStatus.toLowerCase().replace(/_/g, " ")}${
          source === "DERIVED" && p.reason
            ? ` · ${String(p.reason)}`
            : ""
        }`,
      };
    }

    case "OFFICER_DESIGNATED": {
      const role = str(p.officerRole, "officer").toLowerCase();
      const designated = bool(p.designated);
      return {
        icon: "officer",
        verb: designated === false ? "Removed" : "Designated",
        summary: `${role.charAt(0).toUpperCase() + role.slice(1)} Officer`,
        detail: null,
      };
    }

    case "POLICY_ADOPTED":
      return {
        icon: "policy",
        verb: "Adopted",
        summary: str(p.policyCode, "policy"),
        detail: p.version != null ? `version ${String(p.version)}` : null,
      };

    case "POLICY_RETIRED":
      return {
        icon: "policy",
        verb: "Retired",
        summary: str(p.policyCode, "policy"),
        detail: null,
      };

    case "TRAINING_COMPLETED": {
      const score = num(p.score);
      const passed = bool(p.passed);
      return {
        icon: "training",
        verb: passed === false ? "Failed" : "Completed",
        summary: str(p.courseCode, "training course"),
        detail: score != null ? `score ${score}%` : null,
      };
    }

    case "VENDOR_UPSERTED":
      return {
        icon: "vendor",
        verb: "Saved",
        summary: `vendor "${str(p.name, "—")}"`,
        detail: bool(p.processesPhi) === true ? "processes PHI" : null,
      };

    case "VENDOR_BAA_EXECUTED":
      return {
        icon: "vendor",
        verb: "BAA signed",
        summary: `vendor ${str(p.vendorId, "—").slice(0, 8)}`,
        detail: p.expiresAt ? `expires ${String(p.expiresAt).slice(0, 10)}` : null,
      };

    case "VENDOR_REMOVED":
      return {
        icon: "vendor",
        verb: "Removed",
        summary: `vendor ${str(p.vendorId, "—").slice(0, 8)}`,
        detail: null,
      };

    case "CREDENTIAL_UPSERTED":
      return {
        icon: "credential",
        verb: "Saved",
        summary: str(p.credentialTypeCode, "credential"),
        // Audit CR-3: only OWNER/ADMIN see license numbers in the
        // activity log. STAFF/VIEWER still see the entry, just
        // without the PII; "details hidden" makes the redaction
        // visible to the inspector rather than silently swallowed.
        detail: p.licenseNumber
          ? canSeeFullDetail
            ? `#${String(p.licenseNumber)}`
            : "details hidden"
          : null,
      };

    case "CREDENTIAL_REMOVED":
      return {
        icon: "credential",
        verb: "Removed",
        summary: "credential",
        detail: null,
      };

    case "SRA_COMPLETED": {
      const score = num(p.overallScore);
      const addressed = num(p.addressedCount);
      const total = num(p.totalCount);
      return {
        icon: "sra",
        verb: "Completed",
        summary: "Security Risk Assessment",
        detail:
          score != null
            ? `${score}% addressed${addressed != null && total != null ? ` (${addressed}/${total})` : ""}`
            : null,
      };
    }

    case "SRA_DRAFT_SAVED": {
      const step = num(p.currentStep);
      return {
        icon: "sra",
        verb: "Saved draft",
        summary: "SRA in progress",
        detail: step != null ? `step ${step + 1} of 3` : null,
      };
    }

    case "INCIDENT_REPORTED":
      return {
        icon: "incident",
        verb: "Reported",
        summary: `incident "${str(p.title, "untitled")}"`,
        detail: `${str(p.type, "PRIVACY")
          .replace(/_/g, " ")
          .toLowerCase()} · ${str(p.severity, "LOW").toLowerCase()}`,
      };

    case "INCIDENT_BREACH_DETERMINED": {
      const isBreach = bool(p.isBreach);
      const risk = num(p.overallRiskScore);
      return {
        icon: "incident",
        verb: "Determined",
        summary: isBreach ? "reportable breach" : "not a breach",
        detail: risk != null ? `risk score ${risk}/100` : null,
      };
    }

    case "INCIDENT_RESOLVED":
      return {
        icon: "incident",
        verb: "Resolved",
        summary: "incident",
        detail: p.resolution ? String(p.resolution).slice(0, 80) : null,
      };

    // Audit #21 / OSHA M-8: surface admin typo-corrections of OSHA
    // recordable details (PR #213) in the activity feed instead of
    // falling through to the generic "Event …" placeholder. Renders
    // "Updated · OSHA outcome … Days away (5d)" so reviewers can spot
    // §1904.7 record changes without diffing the raw payload.
    case "INCIDENT_OSHA_OUTCOME_UPDATED": {
      const outcome = str(p.oshaOutcome);
      const daysAway = num(p.oshaDaysAway);
      const daysRestricted = num(p.oshaDaysRestricted);
      const detailParts: string[] = [];
      if (outcome) {
        detailParts.push(outcome.replace(/_/g, " ").toLowerCase());
      }
      if (daysAway != null) detailParts.push(`${daysAway}d away`);
      if (daysRestricted != null) {
        detailParts.push(`${daysRestricted}d restricted`);
      }
      return {
        icon: "incident",
        verb: "Updated",
        summary: "OSHA outcome",
        detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
      };
    }

    case "ALLERGY_QUALIFICATION_RECOMPUTED": {
      const next = bool(p.nextQualified);
      const year = num(p.year);
      const reason = str(p.reason);
      return {
        icon: "requirement",
        verb: next === true ? "Qualified" : "Unqualified",
        summary: `allergy compounder${year != null ? ` (${year})` : ""}`,
        detail: reason || null,
      };
    }

    default:
      return {
        icon: "unknown",
        verb: "Event",
        summary: String(type).replace(/_/g, " ").toLowerCase(),
        detail: null,
      };
  }
}
