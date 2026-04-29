// scripts/eval-concierge.ts
//
// Eval harness for the AI Concierge. Reads every fixture under
// tests/fixtures/prompts/concierge.chat/, sets up an isolated practice +
// user + thread per fixture, replays the fixture's messages into the
// thread, runs the non-streaming runConciergeTurn() collector, and asserts:
//   - expectedToolCalls is a SUBSET of the model's observed tool calls
//     (model can call MORE tools than expected, but must call at least
//     the listed ones)
//   - forbiddenStrings do NOT appear in the final assistant text
//     (case-insensitive)
//   - any CFR / USC citations the model emits are in KNOWN_CITATIONS;
//     unknown citations are surfaced as a soft "POSSIBLE HALLUCINATION"
//     warning (not a hard failure — KNOWN_CITATIONS is a curated allow-
//     list, not exhaustive)
//
// Output is a per-fixture pass/fail/warning line + an end summary
// (counts + cumulative cost + tokens). Exits 0 on full pass, 1 on any
// hard fail.
//
// REQUIRED ENV:
//   ANTHROPIC_API_KEY   — real Claude calls; THIS COSTS REAL MONEY
//   DATABASE_URL        — Postgres for per-fixture practice + thread setup
//
// Usage:
//   npm run eval:concierge
//
// CI does NOT run this script — it's an opt-in iteration tool. Each
// fixture's setup-run-teardown is wrapped in try/finally so a partial
// failure doesn't leak rows. The teardown deletes the practice; cascade
// FKs handle PracticeFramework / ConversationThread / ConversationMessage
// / Vendor / Credential / Incident etc.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectConciergeThreadCreated,
  projectConciergeMessageUserSent,
} from "@/lib/events/projections/conciergeThread";
import { runConciergeTurn } from "@/lib/ai/runConciergeTurn";
import {
  KNOWN_CITATIONS,
  extractCitations,
  normalizeCitation,
} from "./lib/eval-concierge-citations";

config({ path: ".env" });

const FIXTURES_DIR = path.resolve(
  __dirname,
  "..",
  "tests",
  "fixtures",
  "prompts",
  "concierge.chat",
);

interface FixtureInputMessage {
  role: "user" | "assistant";
  content: string;
}

interface FixtureInput {
  practiceName: string;
  primaryState: string;
  providerCount: string | null;
  timezone?: string;
  messages: FixtureInputMessage[];
}

interface Fixture {
  name: string;
  input: FixtureInput;
  expectedToolCalls: string[];
  forbiddenStrings: string[];
}

function isFixture(obj: unknown): obj is Fixture {
  if (typeof obj !== "object" || obj === null) return false;
  const f = obj as Partial<Fixture>;
  if (typeof f.name !== "string") return false;
  if (typeof f.input !== "object" || f.input === null) return false;
  const i = f.input as Partial<FixtureInput>;
  if (typeof i.practiceName !== "string") return false;
  if (typeof i.primaryState !== "string") return false;
  if (i.providerCount !== null && typeof i.providerCount !== "string") return false;
  if (!Array.isArray(i.messages) || i.messages.length === 0) return false;
  if (!Array.isArray(f.expectedToolCalls)) return false;
  if (!Array.isArray(f.forbiddenStrings)) return false;
  return true;
}

async function loadFixtures(): Promise<Fixture[]> {
  const entries = await readdir(FIXTURES_DIR);
  const fixtures: Fixture[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const raw = await readFile(path.join(FIXTURES_DIR, name), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Fixture ${name} failed JSON parse: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!isFixture(parsed)) {
      throw new Error(`Fixture ${name} failed schema validation.`);
    }
    fixtures.push(parsed);
  }
  // Stable order — readdir is platform-dependent on Windows.
  fixtures.sort((a, b) => a.name.localeCompare(b.name));
  return fixtures;
}

interface SeededFixture {
  practiceId: string;
  userId: string;
  threadId: string;
}

/**
 * Per-fixture seed: creates an isolated User + Practice + PracticeUser +
 * thread, enrolls every framework with default scores, attaches a
 * realistic minimal data set so Concierge tools return non-empty results.
 *
 * Same data shape across all 20 fixtures — the eval is about prompt /
 * tool-routing behavior, not data variation. Practice name carries the
 * fixture name slug so collisions never happen across fixtures.
 */
async function seedFixture(fixture: Fixture): Promise<SeededFixture> {
  const slug = fixture.name;
  const user = await db.user.create({
    data: {
      firebaseUid: `eval-${slug}-${Math.random().toString(36).slice(2, 10)}`,
      email: `eval-${slug}-${Math.random().toString(36).slice(2, 8)}@guardwell.test`,
      firstName: "Eval",
      lastName: "Tester",
      emailVerified: true,
    },
  });

  const practice = await db.practice.create({
    data: {
      name: `${fixture.input.practiceName} (eval-${slug})`,
      primaryState: fixture.input.primaryState,
      providerCount: fixture.input.providerCount ?? "SOLO",
      specialty: "Primary Care",
      // Eval skips trial / billing gating — fixtures aren't testing subscription state.
      subscriptionStatus: "ACTIVE",
    },
  });

  const practiceUser = await db.practiceUser.create({
    data: {
      userId: user.id,
      practiceId: practice.id,
      role: "OWNER",
      isPrivacyOfficer: true,
      isSecurityOfficer: true,
      isComplianceOfficer: true,
    },
  });

  // Enroll every seeded framework so list_frameworks + get_dashboard_snapshot
  // have rows to return. Default scoreCache=80 lets the model see a
  // moderate score — high enough that "you're failing" isn't the obvious
  // answer but low enough that "what's dragging us down" makes sense.
  const frameworks = await db.regulatoryFramework.findMany();
  for (const fw of frameworks) {
    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: fw.id,
        enabled: true,
        scoreCache: 80,
        scoreLabel: "Good",
        lastScoredAt: new Date(),
      },
    });
  }

  // Three policies attached so list_policies isn't empty.
  const policyCodes = [
    "HIPAA_PRIVACY_POLICY",
    "HIPAA_SECURITY_POLICY",
    "HIPAA_BREACH_RESPONSE_POLICY",
  ];
  for (const code of policyCodes) {
    await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: code,
        version: 1,
        adoptedAt: new Date(),
        lastReviewedAt: new Date(),
      },
    });
  }

  // Active vendor with a current BAA so list_vendors has interesting data.
  await db.vendor.create({
    data: {
      practiceId: practice.id,
      name: "Athena Health",
      type: "EHR",
      processesPhi: true,
      baaDirection: "VENDOR_PROVIDED",
      baaExecutedAt: new Date(),
      baaExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  // One expired credential so list_credentials surfaces an EXPIRED row.
  // We use the first available CredentialType row — eval doesn't care
  // which type it is, only that the tool returns a non-empty list with a
  // status the model can see.
  const credentialType = await db.credentialType.findFirst();
  if (credentialType) {
    await db.credential.create({
      data: {
        practiceId: practice.id,
        holderId: practiceUser.id,
        credentialTypeId: credentialType.id,
        title: "Eval Test License",
        licenseNumber: "EVAL-001",
        expiryDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  // One incident from this month so list_incidents has a row.
  await db.incident.create({
    data: {
      practiceId: practice.id,
      reportedByUserId: user.id,
      title: "Email sent to wrong recipient",
      description:
        "Test fixture incident: appointment reminder email mistakenly sent to a former patient. Single record, no SSN exposed.",
      type: "PRIVACY",
      severity: "LOW",
      status: "OPEN",
      isBreach: false,
      phiInvolved: true,
      affectedCount: 1,
      discoveredAt: new Date(),
    },
  });

  // Compliance Track + a few tasks so get_compliance_track has shape.
  await db.practiceTrack.create({
    data: {
      practiceId: practice.id,
      templateCode: "GENERAL_PRIMARY_CARE",
      generatedAt: new Date(),
    },
  });
  await db.practiceTrackTask.createMany({
    data: [
      {
        practiceId: practice.id,
        weekTarget: 1,
        sortOrder: 10,
        title: "Designate a Privacy Officer",
        description: "Pick the Privacy Officer for your practice.",
        href: "/programs/staff",
        completedAt: new Date(),
      },
      {
        practiceId: practice.id,
        weekTarget: 1,
        sortOrder: 20,
        title: "Designate a Security Officer",
        description: "Pick the Security Officer for your practice.",
        href: "/programs/staff",
        completedAt: new Date(),
      },
      {
        practiceId: practice.id,
        weekTarget: 2,
        sortOrder: 30,
        title: "Conduct a Security Risk Assessment",
        description: "Walk through the SRA wizard.",
        href: "/programs/sra",
      },
    ],
  });

  // Create the thread + replay the fixture's messages so streamConciergeTurn
  // sees them in history. Every message besides the LAST is the
  // "conversation so far"; the last message is the new turn under test.
  const threadId = randomUUID();
  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "CONCIERGE_THREAD_CREATED",
      payload: { threadId, userId: user.id, title: null },
    },
    async (tx) =>
      projectConciergeThreadCreated(tx, {
        practiceId: practice.id,
        payload: { threadId, userId: user.id, title: null },
      }),
  );

  // Persist EACH fixture message in order. USER messages go through the
  // CONCIERGE_MESSAGE_USER_SENT projection. ASSISTANT messages bypass the
  // projection (no event type for synthetic history) and write directly
  // to ConversationMessage so the history-load step in streamConciergeTurn
  // surfaces them. Synthetic history is the realistic shape the harness
  // simulates — we're not exercising the AI roundtrip for prior turns.
  for (const m of fixture.input.messages) {
    if (m.role === "user") {
      const messageId = randomUUID();
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "CONCIERGE_MESSAGE_USER_SENT",
          payload: { messageId, threadId, content: m.content },
        },
        async (tx) =>
          projectConciergeMessageUserSent(tx, {
            practiceId: practice.id,
            payload: { messageId, threadId, content: m.content },
          }),
      );
    } else {
      // assistant
      await db.conversationMessage.create({
        data: {
          threadId,
          role: "ASSISTANT",
          content: m.content,
          payload: { content: m.content },
        },
      });
    }
  }

  return { practiceId: practice.id, userId: user.id, threadId };
}

async function teardownFixture(seeded: SeededFixture): Promise<void> {
  // Cascade FKs handle PracticeFramework / ConversationThread /
  // ConversationMessage / Vendor / Credential / Incident /
  // PracticeTrack / PracticeTrackTask / PracticeUser / PracticePolicy.
  // EventLog rows reference Practice via practiceId (cascade) but
  // LlmCall rows are SetNull on practice delete — they survive the
  // teardown for the cumulative-cost summary at the end.
  try {
    await db.practice.delete({ where: { id: seeded.practiceId } });
  } catch (err) {
    console.warn(
      `[teardown] practice ${seeded.practiceId} delete failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    await db.user.delete({ where: { id: seeded.userId } });
  } catch (err) {
    console.warn(
      `[teardown] user ${seeded.userId} delete failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface FixtureResult {
  name: string;
  passed: boolean;
  warnings: string[];
  failures: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

async function runFixture(fixture: Fixture): Promise<FixtureResult> {
  const result: FixtureResult = {
    name: fixture.name,
    passed: true,
    warnings: [],
    failures: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
  };

  let seeded: SeededFixture | null = null;
  try {
    seeded = await seedFixture(fixture);

    const turn = await runConciergeTurn({
      practiceId: seeded.practiceId,
      practice: {
        name: fixture.input.practiceName,
        primaryState: fixture.input.primaryState,
        providerCount: fixture.input.providerCount,
        timezone: fixture.input.timezone ?? "UTC",
      },
      threadId: seeded.threadId,
      actorUserId: seeded.userId,
    });

    result.inputTokens = turn.inputTokens;
    result.outputTokens = turn.outputTokens;
    result.costUsd = turn.costUsd;

    // Fatal generator errors (UPSTREAM, EMPTY_HISTORY, etc.) → the run
    // is a hard fail because the assertion checks below would be testing
    // an empty / partial response.
    const fatalCodes = new Set([
      "UPSTREAM",
      "EMPTY_HISTORY",
      "ABORTED",
      "ITERATION_CAP_REACHED",
    ]);
    for (const e of turn.errors) {
      if (fatalCodes.has(e.code)) {
        result.failures.push(`generator error: ${e.code} — ${e.message}`);
      } else {
        result.warnings.push(`non-fatal generator event: ${e.code} — ${e.message}`);
      }
    }

    // Assertion 1: expectedToolCalls is a SUBSET of observed tool calls.
    const observedToolNames = new Set(turn.toolCalls.map((t) => t.toolName));
    for (const required of fixture.expectedToolCalls) {
      if (!observedToolNames.has(required)) {
        result.failures.push(
          `expectedToolCalls: missing "${required}" (observed: [${[...observedToolNames].join(", ") || "none"}])`,
        );
      }
    }

    // Assertion 2: no forbiddenString appears in the final text (case-insensitive).
    const haystack = turn.text.toLowerCase();
    for (const forbidden of fixture.forbiddenStrings) {
      if (haystack.includes(forbidden.toLowerCase())) {
        result.failures.push(`forbiddenStrings: "${forbidden}" found in output`);
      }
    }

    // Assertion 3 (soft): citations not in KNOWN_CITATIONS get a warning.
    const cites = extractCitations(turn.text);
    for (const c of cites) {
      const norm = normalizeCitation(c);
      if (!KNOWN_CITATIONS.has(norm)) {
        result.warnings.push(`possible hallucination: ${norm} (not in KNOWN_CITATIONS)`);
      }
    }
  } catch (err) {
    result.failures.push(
      `harness error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    if (seeded) {
      await teardownFixture(seeded);
    }
  }

  result.passed = result.failures.length === 0;
  return result;
}

function formatLine(idx: number, total: number, r: FixtureResult): string {
  const idxLabel = `[${idx}/${total}]`.padEnd(8);
  const nameLabel = r.name.padEnd(34);
  if (r.failures.length === 0 && r.warnings.length === 0) {
    return `${idxLabel} ${nameLabel} pass`;
  }
  if (r.failures.length === 0) {
    const warningLines = r.warnings.map((w) => `        warning: ${w}`).join("\n");
    return `${idxLabel} ${nameLabel} pass (with warnings)\n${warningLines}`;
  }
  const failureLines = r.failures.map((f) => `        ${f}`).join("\n");
  if (r.warnings.length > 0) {
    const warningLines = r.warnings.map((w) => `        warning: ${w}`).join("\n");
    return `${idxLabel} ${nameLabel} fail\n${failureLines}\n${warningLines}`;
  }
  return `${idxLabel} ${nameLabel} fail\n${failureLines}`;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Eval requires real Claude calls.");
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Eval requires a Postgres database.");
    process.exitCode = 2;
    return;
  }

  // Production-DB safety guard. Log the resolved DATABASE_URL host (just
  // the host — not credentials) so a misconfigured run is visible at
  // startup, then refuse to run if the host looks like production.
  // The pattern is intentionally permissive: anything with "prod",
  // "production", "live", or one of GuardWell's known prod project IDs
  // in the host gets blocked. Dev hosts (localhost, 127.0.0.1, Docker
  // service names like "test-db", Cloud SQL dev instances) all pass.
  // Override with --allow-prod for the rare case of a deliberate prod
  // run.
  const dbUrl = process.env.DATABASE_URL ?? "";
  const dbHost = (() => {
    try {
      return new URL(dbUrl).host;
    } catch {
      return "<invalid>";
    }
  })();
  console.error(`[eval-concierge] DATABASE_URL host: ${dbHost}`);

  const looksLikeProd =
    /\bprod\b|production|live/i.test(dbHost) ||
    /(guardwell-v2-prod|guardwell-prod|gw-prod)/i.test(dbHost);

  if (looksLikeProd && !process.argv.includes("--allow-prod")) {
    console.error(
      `[eval-concierge] Refusing to run: DATABASE_URL host '${dbHost}' looks like production.\n` +
        `If you really mean it, re-run with --allow-prod.`,
    );
    process.exitCode = 2;
    return;
  }

  // Fail-fast guard: an unseeded test DB has zero RegulatoryFramework
  // rows, which would silently produce empty practice-framework
  // enrollments and meaningless eval results. Force the operator to run
  // the seed scripts first.
  const frameworkCount = await db.regulatoryFramework.count();
  if (frameworkCount === 0) {
    console.error(
      `[eval-concierge] No RegulatoryFramework rows found. Run \`npm run db:seed\` first.`,
    );
    process.exitCode = 2;
    return;
  }

  const fixtures = await loadFixtures();
  console.log(`Loaded ${fixtures.length} fixtures from ${FIXTURES_DIR}\n`);

  let passCount = 0;
  let failCount = 0;
  let warningCount = 0;
  let cumulativeInput = 0;
  let cumulativeOutput = 0;
  let cumulativeCost = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const fx = fixtures[i]!;
    const r = await runFixture(fx);
    console.log(formatLine(i + 1, fixtures.length, r));
    if (r.passed) passCount += 1;
    else failCount += 1;
    if (r.warnings.length > 0) warningCount += 1;
    cumulativeInput += r.inputTokens;
    cumulativeOutput += r.outputTokens;
    if (r.costUsd) cumulativeCost += r.costUsd;
  }

  console.log("");
  console.log(
    `Eval summary: ${passCount} pass, ${failCount} fail (${warningCount} warnings)`,
  );
  console.log(`Cost: $${cumulativeCost.toFixed(4)} (estimated from sum of result.costUsd)`);
  console.log(
    `Tokens: ${cumulativeInput.toLocaleString()} in / ${cumulativeOutput.toLocaleString()} out`,
  );

  // Set exit code so any pending async cleanup (.finally below, console
  // flush buffering on some terminals) still runs before Node tears down.
  process.exitCode = failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("[eval-concierge] fatal:", err);
  process.exitCode = 1;
});
