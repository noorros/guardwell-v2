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
  handle(args: { practiceId: string; input: unknown }): Promise<unknown>;
}

const EMPTY_INPUT_SCHEMA = z.object({}).strict();
const EMPTY_INPUT_SCHEMA_JSON = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
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
    async handle({ practiceId }) {
      const rows = await db.practicePolicy.findMany({
        where: { practiceId, retiredAt: null },
        select: {
          policyCode: true,
          version: true,
          adoptedAt: true,
          lastReviewedAt: true,
        },
        orderBy: { adoptedAt: "desc" },
        take: 100,
      });
      return { policies: rows, _truncated: rows.length === 100 };
    },
  },

  list_incidents: {
    name: "list_incidents",
    description:
      "List the practice's 20 most recent incidents (privacy, security, OSHA, breach, etc.).",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId }) {
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
      return { incidents: rows, _truncated: false };
    },
  },

  list_vendors: {
    name: "list_vendors",
    description: "List vendors with BAA status (executed/expired/missing).",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId }) {
      // SCHEMA NOTE: Vendor uses `retiredAt` (not `removedAt`).
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
        take: 100,
      });
      return { vendors: rows, _truncated: rows.length === 100 };
    },
  },

  list_credentials: {
    name: "list_credentials",
    description: "List Credential rows (licenses, registrations, certifications) with derived status.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId }) {
      // SCHEMA NOTE: Credential has no `status` column — derive from expiryDate.
      // Credential.credentialTypeId is an FK; resolve to .code via include.
      const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const rows = await db.credential.findMany({
        where: { practiceId, retiredAt: null },
        include: { credentialType: { select: { code: true } } },
        orderBy: { expiryDate: "asc" },
        take: 100,
      });
      const credentials = rows.map((c) => {
        let status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "NO_EXPIRY" = "NO_EXPIRY";
        if (c.expiryDate) {
          const t = c.expiryDate.getTime();
          if (t < now) status = "EXPIRED";
          else if (t - now < NINETY_DAYS_MS) status = "EXPIRING_SOON";
          else status = "ACTIVE";
        }
        return {
          credentialTypeCode: c.credentialType.code,
          holderId: c.holderId,
          title: c.title,
          expiryDate: c.expiryDate,
          status,
        };
      });
      return { credentials, _truncated: rows.length === 100 };
    },
  },

  get_compliance_track: {
    name: "get_compliance_track",
    description:
      "Get the practice's auto-generated Compliance Track and progress.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId }) {
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
          generatedAt: track.generatedAt,
          completedAt: track.completedAt,
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
      "Get the practice's overall compliance snapshot (score, framework count, open incidents, expiring credentials).",
    inputSchema: EMPTY_INPUT_SCHEMA,
    inputSchemaJson: EMPTY_INPUT_SCHEMA_JSON,
    async handle({ practiceId }) {
      const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
      const now = new Date();
      const ninetyDayCutoff = new Date(now.getTime() + NINETY_DAYS_MS);
      const [frameworks, openIncidents, expiringCredentials] = await Promise.all([
        db.practiceFramework.findMany({
          where: { practiceId, enabled: true },
          select: { scoreCache: true },
        }),
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
      const overallScore =
        frameworks.length > 0
          ? Math.round(
              frameworks.reduce((acc, f) => acc + (f.scoreCache ?? 0), 0) / frameworks.length,
            )
          : 0;
      return {
        overallScore,
        frameworkCount: frameworks.length,
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
