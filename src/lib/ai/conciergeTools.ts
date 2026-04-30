// src/lib/ai/conciergeTools.ts
//
// THE SOURCE OF TRUTH for what tools the AI Concierge can call. Adding a
// new tool is a 3-step pattern:
//   1. Add an entry to TOOL_REGISTRY below
//   2. Provide the Zod inputSchema + the JSON-schema-shaped inputSchemaJson
//      (Anthropic's tool input_schema format)
//   3. Implement the handler(args). Read-only — no writes, no side effects.
//
// All tools return objects shaped { ...primary, _truncated: boolean } so the
// Concierge can detect when row caps clipped output.

import { z } from "zod";
import { db } from "@/lib/db";
import { computeOverallScore } from "@/lib/compliance/overallScore";
import { formatPracticeDate } from "@/lib/audit/format";
import {
  getCredentialStatus,
  type CredentialStatus as SharedCredentialStatus,
} from "@/lib/credentials/status";
import { getCitationForCredentialType } from "@/lib/regulations/citations";

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  // Anthropic SDK tool input_schema shape (a JSON-Schema-ish object)
  inputSchemaJson: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handle(args: { practiceId: string; practiceTimezone: string; input: unknown }): Promise<unknown>;
}

// .strict() rejects extra keys — Concierge tools that take no input must receive {} exactly.
const EMPTY_INPUT_SCHEMA = z.object({}).strict();
const EMPTY_INPUT_SCHEMA_JSON = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

// Sort order for list_credentials so the rows most needing attention show
// up first (and survive the 100-row cap). EXPIRED is most urgent;
// NO_EXPIRY rows have no deadline so they're least actionable.
const STATUS_PRIORITY: Record<SharedCredentialStatus, number> = {
  EXPIRED: 0,
  EXPIRING_SOON: 1,
  ACTIVE: 2,
  NO_EXPIRY: 3,
};

export const TOOL_REGISTRY: Record<string, ToolHandler> = {
  list_frameworks: {
    name: "list_frameworks",
    description:
      "List the regulatory frameworks this practice is enrolled in with current compliance score and counts.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId }) {
      const rows = await db.practiceFramework.findMany({
        where: { practiceId, enabled: true },
        include: { framework: true },
      });
      const out = await Promise.all(
        rows.map(async (pf) => {
          const items = await db.complianceItem.findMany({
            where: { practiceId, requirement: { frameworkId: pf.frameworkId } },
            select: { status: true },
          });
          const total = items.length;
          const compliantCount = items.filter((i) => i.status === "COMPLIANT").length;
          const gapCount = items.filter((i) => i.status === "GAP").length;
          return {
            code: pf.framework.code,
            name: pf.framework.name,
            score: pf.scoreCache,
            total,
            compliantCount,
            gapCount,
          };
        }),
      );
      return { frameworks: out, _truncated: false };
    },
  },

  list_requirements_by_framework: {
    name: "list_requirements_by_framework",
    description:
      "List requirements in a single framework (by code: HIPAA, OSHA, etc.) with current ComplianceItem status.",
    inputSchema: z.object({ frameworkCode: z.string().min(1).max(20) }).strict(),
    inputSchemaJson: {
      type: "object",
      properties: { frameworkCode: { type: "string" } },
      required: ["frameworkCode"],
      additionalProperties: false,
    },
    async handle({ practiceId, input }) {
      const { frameworkCode } = input as { frameworkCode: string };
      const fw = await db.regulatoryFramework.findUnique({
        where: { code: frameworkCode.toUpperCase() },
        include: { requirements: { orderBy: { sortOrder: "asc" } } },
      });
      if (!fw) {
        return {
          requirements: [],
          _truncated: false,
          error: `Unknown framework: ${frameworkCode}`,
        };
      }
      const items = await db.complianceItem.findMany({
        where: { practiceId, requirementId: { in: fw.requirements.map((r) => r.id) } },
      });
      const byReq = new Map(items.map((i) => [i.requirementId, i]));
      const truncated = fw.requirements.length > 100;
      const slice = fw.requirements.slice(0, 100);
      return {
        requirements: slice.map((r) => ({
          code: r.code,
          title: r.title,
          status: byReq.get(r.id)?.status ?? "NOT_STARTED",
          severity: r.severity,
          citation: r.citation,
        })),
        _truncated: truncated,
      };
    },
  },

  list_policies: {
    name: "list_policies",
    description: "List all PracticePolicy rows currently adopted (not retired).",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId, practiceTimezone }) {
      // take: 101 + slice(0, 100) is the standard pattern for detecting
      // truncation without a false-positive when row count == cap.
      const rows = await db.practicePolicy.findMany({
        where: { practiceId, retiredAt: null },
        select: {
          policyCode: true,
          version: true,
          adoptedAt: true,
          lastReviewedAt: true,
        },
        orderBy: { adoptedAt: "desc" },
        take: 101,
      });
      const truncated = rows.length > 100;
      const slice = rows.slice(0, 100).map((p) => ({
        policyCode: p.policyCode,
        version: p.version,
        adoptedAt: formatPracticeDate(p.adoptedAt, practiceTimezone),
        lastReviewedAt: p.lastReviewedAt
          ? formatPracticeDate(p.lastReviewedAt, practiceTimezone)
          : null,
      }));
      return { policies: slice, _truncated: truncated };
    },
  },

  list_incidents: {
    name: "list_incidents",
    description:
      "List the practice's 20 most recent incidents (privacy, security, OSHA, breach, etc.).",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId, practiceTimezone }) {
      const rows = await db.incident.findMany({
        where: { practiceId },
        orderBy: { discoveredAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          type: true,
          severity: true,
          isBreach: true,
          resolvedAt: true,
          affectedCount: true,
          discoveredAt: true,
        },
      });
      const incidents = rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        severity: r.severity,
        isBreach: r.isBreach,
        affectedCount: r.affectedCount,
        discoveredAt: formatPracticeDate(r.discoveredAt, practiceTimezone),
        resolvedAt: r.resolvedAt
          ? formatPracticeDate(r.resolvedAt, practiceTimezone)
          : null,
      }));
      return { incidents, _truncated: false };
    },
  },

  list_vendors: {
    name: "list_vendors",
    description: "List vendors with BAA status (executed/expired/missing).",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId, practiceTimezone }) {
      // SCHEMA NOTE: Vendor uses `retiredAt` (not `removedAt`).
      // take: 101 + slice(0, 100) — see list_policies for rationale.
      const rows = await db.vendor.findMany({
        where: { practiceId, retiredAt: null },
        select: {
          name: true,
          type: true,
          processesPhi: true,
          baaExecutedAt: true,
          baaExpiresAt: true,
        },
        orderBy: { name: "asc" },
        take: 101,
      });
      const truncated = rows.length > 100;
      const slice = rows.slice(0, 100).map((v) => ({
        name: v.name,
        type: v.type,
        processesPhi: v.processesPhi,
        baaExecutedAt: v.baaExecutedAt
          ? formatPracticeDate(v.baaExecutedAt, practiceTimezone)
          : null,
        baaExpiresAt: v.baaExpiresAt
          ? formatPracticeDate(v.baaExpiresAt, practiceTimezone)
          : null,
      }));
      return { vendors: slice, _truncated: truncated };
    },
  },

  list_credentials: {
    name: "list_credentials",
    description: "List Credential rows (licenses, registrations, certifications) with derived status.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId, practiceTimezone }) {
      // SCHEMA NOTE: Credential has no `status` column — derive from
      // expiryDate via the shared helper (audit #16). Credential
      // .credentialTypeId is an FK; resolve to .code via include.
      //
      // Fetch all rows (no DB-side cap), derive status, sort by
      // STATUS_PRIORITY so the most actionable rows surface first
      // (EXPIRED → EXPIRING_SOON → ACTIVE → NO_EXPIRY), then slice to 100.
      // Sorting client-side avoids the Postgres NULLS LAST default silently
      // clipping NO_EXPIRY rows when a practice has >100 credentials.
      // Performance: typical practice has <50 credentials; even 500 rows
      // are a single fast query, then in-memory sort.
      const nowDate = new Date();
      const rows = await db.credential.findMany({
        where: { practiceId, retiredAt: null },
        include: {
          credentialType: { select: { code: true, category: true } },
        },
      });
      const allCredentials = rows.map((c) => {
        const status = getCredentialStatus(c.expiryDate, nowDate);
        // Audit #21 IM-8 (PR-C6): surface the underlying federal/state
        // citation so the Concierge LLM has an anchor to cite when the
        // user asks "why does this credential need to be on file".
        const citation = getCitationForCredentialType(
          c.credentialType.code,
          c.credentialType.category,
        );
        return {
          // IM-9 (audit #21): expose `id` so the Concierge LLM can build
          // click-through links to /credentials/[id].
          id: c.id,
          credentialTypeCode: c.credentialType.code,
          holderId: c.holderId,
          title: c.title,
          expiryDate: c.expiryDate
            ? formatPracticeDate(c.expiryDate, practiceTimezone)
            : null,
          status,
          regulation: citation
            ? { code: citation.code, display: citation.display, title: citation.title }
            : null,
        };
      });
      allCredentials.sort(
        (a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status],
      );
      const truncated = allCredentials.length > 100;
      const slice = allCredentials.slice(0, 100);
      return { credentials: slice, _truncated: truncated };
    },
  },

  list_allergy_compounders: {
    name: "list_allergy_compounders",
    description:
      "List PracticeUsers flagged as USP 797 §21 allergen-extract compounders (requiresAllergyCompetency=true) with their current-year qualification status (FULLY_QUALIFIED / IN_PROGRESS / NOT_QUALIFIED / not-yet-this-year).",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId, practiceTimezone }) {
      // SCHEMA NOTE: PracticeUser.requiresAllergyCompetency is the
      // compounder gate. AllergyCompetency is per-(practiceUser, year) —
      // absence of a current-year row means qualification hasn't started
      // for this year yet (status: "not-yet-this-year").
      const year = new Date().getFullYear();
      const compounders = await db.practiceUser.findMany({
        where: {
          practiceId,
          requiresAllergyCompetency: true,
          removedAt: null,
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      });
      const competencies = await db.allergyCompetency.findMany({
        where: {
          practiceId,
          year,
          practiceUserId: { in: compounders.map((c) => c.id) },
        },
      });
      const byUser = new Map(competencies.map((c) => [c.practiceUserId, c]));
      const compoundersOut = compounders.map((m) => {
        const name =
          [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") ||
          m.user.email ||
          "Unknown";
        const c = byUser.get(m.id);
        if (!c) {
          return {
            practiceUserId: m.id,
            name,
            qualificationStatus: "not-yet-this-year" as const,
            lastQualifiedAt: null,
            currentYearProgress: "No competency record for this year yet",
          };
        }
        const quizDone = Boolean(c.quizPassedAt);
        const mediaFillDone = Boolean(c.mediaFillPassedAt);
        const fingertipCount = c.fingertipPassCount;
        // Mirrors recomputeIsFullyQualified() — initial year requires 3
        // fingertip passes; subsequent (renewal) year only 1.
        const fingertipNeeded = c.isFullyQualified ? fingertipCount : 3;
        let qualificationStatus:
          | "FULLY_QUALIFIED"
          | "IN_PROGRESS"
          | "NOT_QUALIFIED";
        if (c.isFullyQualified) {
          qualificationStatus = "FULLY_QUALIFIED";
        } else if (quizDone || fingertipCount > 0 || mediaFillDone) {
          qualificationStatus = "IN_PROGRESS";
        } else {
          qualificationStatus = "NOT_QUALIFIED";
        }
        const progress = [
          `${fingertipCount} of ${fingertipNeeded} fingertip pass(es)`,
          quizDone ? "quiz passed" : "quiz pending",
          mediaFillDone ? "media-fill passed" : "media-fill pending",
        ].join(", ");
        return {
          practiceUserId: m.id,
          name,
          qualificationStatus,
          lastQualifiedAt: c.fingertipLastPassedAt
            ? formatPracticeDate(c.fingertipLastPassedAt, practiceTimezone)
            : null,
          currentYearProgress: progress,
        };
      });
      return { compounders: compoundersOut, _truncated: false };
    },
  },

  get_allergy_drill_status: {
    name: "get_allergy_drill_status",
    description:
      "Get the latest anaphylaxis drill timing for the practice — last drill date, days since, next drill due, overdue indicator, participant count, and a truncated scenario summary. USP 797 §21 requires an annual drill.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId, practiceTimezone }) {
      // SCHEMA NOTE: AllergyDrill.retiredAt is the audit-#15 soft-delete
      // marker — exclude retired rows so the Concierge always reports
      // the "active" latest drill.
      const latest = await db.allergyDrill.findFirst({
        where: { practiceId, retiredAt: null },
        orderBy: { conductedAt: "desc" },
      });
      if (!latest) {
        return {
          lastDrillDate: null,
          daysSinceLastDrill: null,
          nextDrillDue: null,
          overdueByDays: null,
          participantCount: 0,
          scenarioSummary: null,
        };
      }
      const now = new Date();
      const DAY_MS = 24 * 60 * 60 * 1000;
      const daysSinceLastDrill = Math.floor(
        (now.getTime() - latest.conductedAt.getTime()) / DAY_MS,
      );
      const overdueByDays =
        latest.nextDrillDue && latest.nextDrillDue.getTime() < now.getTime()
          ? Math.floor(
              (now.getTime() - latest.nextDrillDue.getTime()) / DAY_MS,
            )
          : 0;
      // Truncate scenario to keep payload small — Concierge can ask for
      // the full row via /programs/allergy if the user wants details.
      const SCENARIO_MAX = 200;
      const scenarioSummary =
        latest.scenario.length > SCENARIO_MAX
          ? `${latest.scenario.slice(0, SCENARIO_MAX)}…`
          : latest.scenario;
      return {
        lastDrillDate: formatPracticeDate(latest.conductedAt, practiceTimezone),
        daysSinceLastDrill,
        nextDrillDue: latest.nextDrillDue
          ? formatPracticeDate(latest.nextDrillDue, practiceTimezone)
          : null,
        overdueByDays,
        participantCount: latest.participantIds.length,
        scenarioSummary,
      };
    },
  },

  get_fridge_readings: {
    name: "get_fridge_readings",
    description:
      "List recent allergen-extract refrigerator temperature readings (latest first). Default 10, max 30. Each reading includes whether it was within the acceptable 2.0–8.0°C range.",
    inputSchema: z
      .object({
        limit: z.number().int().min(1).max(30).optional(),
      })
      .strict(),
    inputSchemaJson: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
    async handle({ practiceId, practiceTimezone, input }) {
      // SCHEMA NOTE: fridge readings are AllergyEquipmentCheck rows with
      // checkType=REFRIGERATOR_TEMP. inRange is stored on the row (set at
      // log time per the 2.0–8.0°C threshold). retiredAt filters out
      // soft-deleted (audit #15) rows.
      const { limit } = input as { limit?: number };
      const take = limit ?? 10;
      const rows = await db.allergyEquipmentCheck.findMany({
        where: {
          practiceId,
          checkType: "REFRIGERATOR_TEMP",
          retiredAt: null,
        },
        include: {
          checkedBy: {
            include: {
              user: { select: { firstName: true, lastName: true, email: true } },
            },
          },
        },
        orderBy: { checkedAt: "desc" },
        take,
      });
      const readings = rows.map((r) => {
        // Privacy: return only display name, never the full user object —
        // matches the per-row name pattern used in list_incidents.
        const name =
          [r.checkedBy.user.firstName, r.checkedBy.user.lastName]
            .filter(Boolean)
            .join(" ") ||
          r.checkedBy.user.email ||
          "Unknown";
        return {
          recordedAt: formatPracticeDate(r.checkedAt, practiceTimezone),
          recordedBy: name,
          temperature: r.temperatureC,
          unit: "C" as const,
          inRange: r.inRange,
          notes: r.notes,
        };
      });
      return { readings, _truncated: false };
    },
  },

  get_compliance_track: {
    name: "get_compliance_track",
    description:
      "Get the practice's auto-generated Compliance Track and progress.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId, practiceTimezone }) {
      const track = await db.practiceTrack.findUnique({
        where: { practiceId },
        include: { tasks: { select: { id: true, completedAt: true } } },
      });
      if (!track) return { track: null };
      const total = track.tasks.length;
      const completed = track.tasks.filter((t) => t.completedAt).length;
      return {
        track: {
          templateCode: track.templateCode,
          generatedAt: formatPracticeDate(track.generatedAt, practiceTimezone),
          completedAt: track.completedAt
            ? formatPracticeDate(track.completedAt, practiceTimezone)
            : null,
          totalTasks: total,
          completedTasks: completed,
          openTasks: total - completed,
        },
      };
    },
  },

  get_dashboard_snapshot: {
    name: "get_dashboard_snapshot",
    description:
      "Get the practice's overall compliance snapshot — overall score (compliant requirements / total applicable, jurisdiction-filtered), enrolled framework count, open incident count, and credentials expiring within the next 90 days.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId }) {
      // Score is computed via computeOverallScore() — the same helper the
      // /audit/overview dashboard uses — so the Concierge's number always
      // matches what the user sees in the UI.
      const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
      const now = new Date();
      const ninetyDayCutoff = new Date(now.getTime() + NINETY_DAYS_MS);
      const [overall, frameworkCount, openIncidents, expiringCredentials] = await Promise.all([
        computeOverallScore(practiceId),
        db.practiceFramework.count({ where: { practiceId, enabled: true } }),
        // SCHEMA NOTE: Incident.resolvedAt = null is the "open" signal.
        db.incident.count({ where: { practiceId, resolvedAt: null } }),
        db.credential.count({
          where: {
            practiceId,
            retiredAt: null,
            expiryDate: { lte: ninetyDayCutoff, gte: now },
          },
        }),
      ]);
      return {
        overallScore: overall.score,
        frameworkCount,
        openIncidentCount: openIncidents,
        expiringCredentialsCount: expiringCredentials,
      };
    },
  },
};

export function getAnthropicToolDefinitions(): Array<{
  name: string;
  description: string;
  input_schema: ToolHandler["inputSchemaJson"];
}> {
  return Object.values(TOOL_REGISTRY).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchemaJson,
  }));
}

export async function invokeTool(args: {
  toolName: string;
  practiceId: string;
  practiceTimezone: string;
  input: unknown;
}): Promise<{
  output: unknown;
  error: string | null;
  latencyMs: number;
}> {
  const handler = TOOL_REGISTRY[args.toolName];
  if (!handler) {
    return { output: null, error: `Unknown tool: ${args.toolName}`, latencyMs: 0 };
  }
  const parsed = handler.inputSchema.safeParse(args.input);
  if (!parsed.success) {
    return {
      output: null,
      error: `INPUT_SCHEMA: ${parsed.error.message}`,
      latencyMs: 0,
    };
  }
  const started = Date.now();
  try {
    const output = await handler.handle({
      practiceId: args.practiceId,
      practiceTimezone: args.practiceTimezone,
      input: parsed.data,
    });
    return { output, error: null, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : "TOOL_HANDLER_FAILURE",
      latencyMs: Date.now() - started,
    };
  }
}
