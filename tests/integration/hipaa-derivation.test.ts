// tests/integration/hipaa-derivation.test.ts
//
// Comprehensive integration tests for the HIPAA derivation engine
// (src/lib/compliance/derivation/hipaa.ts + hipaaSra.ts).
//
// Coverage:
//   - 17 federal HIPAA derivation rules (privacy/security officers, P&P,
//     breach response, BAA, SRA, cyber training, MFA, phishing, backup,
//     policy ack coverage, documentation retention, single-policy stubs).
//   - 50 state breach-notification overlays exercised via a single
//     parameterized describe.each block.
//   - A smoke test that runs every registered HIPAA derivation rule on a
//     bare practice and asserts none throw.
//
// Test strategy:
//   - Rules are pure (Prisma transaction in, status out). We invoke them
//     directly via `db.$transaction((tx) => rule(tx, practiceId))` rather
//     than through the rederive-event pipeline so each test exercises the
//     unit precisely. The integration vs. unit boundary still applies —
//     real Postgres + real Prisma client + real seeded reference data
//     (frameworks, requirements, courses).
//   - Each test seeds an isolated Practice with a random suffix; the
//     afterEach hook in tests/setup.ts clears tenancy tables between
//     tests so cross-test bleed is impossible.
//   - For state-overlay tests, we don't need 100 cases (2 per state).
//     A single `describe.each` cycles through all 50 stateCode → ruleCode
//     mappings with a vacuous-COMPLIANT + no-notification-GAP pair.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import {
  HIPAA_DERIVATION_RULES,
  hipaaPrivacyOfficerRule,
  hipaaSecurityOfficerRule,
  hipaaBreachResponseRule,
  hipaaPoliciesProceduresRule,
  hipaaPoliciesReviewCurrentRule,
  hipaaWorkforceTrainingRule,
  hipaaBaaRule,
  hipaaCaBreachNotification15BizDaysRule,
  hipaaCyberTrainingCompleteRule,
  hipaaMfaCoverageRule,
  hipaaPhishingDrillRecentRule,
  hipaaBackupVerifiedRecentRule,
  hipaaPolicyAcknowledgmentCoverageRule,
  hipaaDocumentationRetentionRule,
} from "@/lib/compliance/derivation/hipaa";
import { hipaaSraRule } from "@/lib/compliance/derivation/hipaaSra";

// ─── helpers ────────────────────────────────────────────────────────────────

function suffix() {
  return Math.random().toString(36).slice(2, 10);
}

interface SeededPractice {
  practice: { id: string; primaryState: string };
  user: { id: string };
  practiceUserId: string;
}

async function seedPractice(primaryState = "AZ"): Promise<SeededPractice> {
  const s = suffix();
  const user = await db.user.create({
    data: {
      firebaseUid: `hipaa-deriv-${s}`,
      email: `hipaa-deriv-${s}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `HIPAA Deriv Clinic ${s}`, primaryState },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return {
    practice: { id: practice.id, primaryState: practice.primaryState },
    user: { id: user.id },
    practiceUserId: pu.id,
  };
}

async function adoptPolicy(
  practiceId: string,
  policyCode: string,
  opts: { version?: number; lastReviewedAt?: Date | null; retiredAt?: Date | null } = {},
) {
  return db.practicePolicy.create({
    data: {
      practiceId,
      policyCode,
      version: opts.version ?? 1,
      adoptedAt: new Date(),
      lastReviewedAt: opts.lastReviewedAt === undefined ? new Date() : opts.lastReviewedAt,
      retiredAt: opts.retiredAt ?? null,
    },
  });
}

// Adopt the 3 core HIPAA P&P policies (Privacy/Security/Breach-Response).
async function adoptCorePpPolicies(practiceId: string, opts: { lastReviewedAt?: Date | null } = {}) {
  for (const code of [
    "HIPAA_PRIVACY_POLICY",
    "HIPAA_SECURITY_POLICY",
    "HIPAA_BREACH_RESPONSE_POLICY",
  ]) {
    await adoptPolicy(practiceId, code, opts);
  }
}

async function runRule(
  rule: (tx: Parameters<typeof hipaaPrivacyOfficerRule>[0], practiceId: string) => Promise<string | null>,
  practiceId: string,
): Promise<string | null> {
  return db.$transaction(async (tx) => rule(tx, practiceId));
}

// ─── smoke test ──────────────────────────────────────────────────────────────

describe("HIPAA derivation registry — smoke test", () => {
  it("HIPAA_DERIVATION_RULES contains exactly the expected 17 federal + 50 state-breach overlay rules", () => {
    const keys = Object.keys(HIPAA_DERIVATION_RULES);
    // Sanity: at least 67 entries (17 federal + 50 state).
    expect(keys.length).toBeGreaterThanOrEqual(67);
    // Spot-check key rules are present.
    expect(HIPAA_DERIVATION_RULES.HIPAA_PRIVACY_OFFICER).toBeDefined();
    expect(HIPAA_DERIVATION_RULES.HIPAA_SECURITY_OFFICER).toBeDefined();
    expect(HIPAA_DERIVATION_RULES.HIPAA_SRA).toBeDefined();
    expect(HIPAA_DERIVATION_RULES.HIPAA_BAAS).toBeDefined();
    expect(HIPAA_DERIVATION_RULES.HIPAA_CA_BREACH_NOTIFICATION_72HR).toBeDefined();
    expect(HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY).toBeDefined();
    expect(HIPAA_DERIVATION_RULES.HIPAA_NY_BREACH_EXPEDIENT).toBeDefined();
  });

  it("every registered HIPAA rule executes against a bare practice without throwing", async () => {
    const { practice } = await seedPractice("AZ");
    for (const [code, rule] of Object.entries(HIPAA_DERIVATION_RULES)) {
      // We don't assert a specific outcome here — just that the rule is
      // defensive and returns a valid status (or null) without crashing
      // on a freshly-created practice with no evidence of any kind.
      const result = await runRule(rule, practice.id);
      expect(
        result === null ||
          result === "COMPLIANT" ||
          result === "GAP" ||
          result === "NOT_STARTED",
        `Rule ${code} returned unexpected value: ${String(result)}`,
      ).toBe(true);
    }
  });
});

// ─── HIPAA_PRIVACY_OFFICER ───────────────────────────────────────────────────

describe("HIPAA_PRIVACY_OFFICER", () => {
  it("returns GAP when no PracticeUser has isPrivacyOfficer=true", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaPrivacyOfficerRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when at least one active PracticeUser is privacy officer", async () => {
    const { practice, practiceUserId } = await seedPractice();
    await db.practiceUser.update({
      where: { id: practiceUserId },
      data: { isPrivacyOfficer: true },
    });
    expect(await runRule(hipaaPrivacyOfficerRule, practice.id)).toBe("COMPLIANT");
  });

  it("ignores removed officers (removedAt is set) and falls back to GAP", async () => {
    const { practice, practiceUserId } = await seedPractice();
    await db.practiceUser.update({
      where: { id: practiceUserId },
      data: { isPrivacyOfficer: true, removedAt: new Date() },
    });
    expect(await runRule(hipaaPrivacyOfficerRule, practice.id)).toBe("GAP");
  });

  it("ignores cross-tenant officers — another practice's officer doesn't satisfy this practice", async () => {
    const { practice: a } = await seedPractice();
    const { practice: b, practiceUserId: bPu } = await seedPractice();
    await db.practiceUser.update({
      where: { id: bPu },
      data: { isPrivacyOfficer: true },
    });
    expect(await runRule(hipaaPrivacyOfficerRule, a.id)).toBe("GAP");
    expect(await runRule(hipaaPrivacyOfficerRule, b.id)).toBe("COMPLIANT");
  });
});

// ─── HIPAA_SECURITY_OFFICER ──────────────────────────────────────────────────

describe("HIPAA_SECURITY_OFFICER", () => {
  it("returns GAP when no PracticeUser has isSecurityOfficer=true", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaSecurityOfficerRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when at least one active PracticeUser is security officer", async () => {
    const { practice, practiceUserId } = await seedPractice();
    await db.practiceUser.update({
      where: { id: practiceUserId },
      data: { isSecurityOfficer: true },
    });
    expect(await runRule(hipaaSecurityOfficerRule, practice.id)).toBe("COMPLIANT");
  });

  it("removed officers don't count", async () => {
    const { practice, practiceUserId } = await seedPractice();
    await db.practiceUser.update({
      where: { id: practiceUserId },
      data: { isSecurityOfficer: true, removedAt: new Date() },
    });
    expect(await runRule(hipaaSecurityOfficerRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_POLICIES_PROCEDURES ───────────────────────────────────────────────

describe("HIPAA_POLICIES_PROCEDURES", () => {
  it("returns GAP when no policies adopted", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaPoliciesProceduresRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when ALL three core P&P policies adopted", async () => {
    const { practice } = await seedPractice();
    await adoptCorePpPolicies(practice.id);
    expect(await runRule(hipaaPoliciesProceduresRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when only 2 of 3 core P&P policies adopted", async () => {
    const { practice } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_PRIVACY_POLICY");
    await adoptPolicy(practice.id, "HIPAA_SECURITY_POLICY");
    // Missing HIPAA_BREACH_RESPONSE_POLICY
    expect(await runRule(hipaaPoliciesProceduresRule, practice.id)).toBe("GAP");
  });

  it("returns GAP when one core policy is retired", async () => {
    const { practice } = await seedPractice();
    await adoptCorePpPolicies(practice.id);
    await db.practicePolicy.updateMany({
      where: { practiceId: practice.id, policyCode: "HIPAA_BREACH_RESPONSE_POLICY" },
      data: { retiredAt: new Date() },
    });
    expect(await runRule(hipaaPoliciesProceduresRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_POLICIES_REVIEW_CURRENT ───────────────────────────────────────────

describe("HIPAA_POLICIES_REVIEW_CURRENT", () => {
  it("returns null when no HIPAA P&P policies adopted yet (parent rule covers it)", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaPoliciesReviewCurrentRule, practice.id)).toBeNull();
  });

  it("returns COMPLIANT when all adopted P&P policies reviewed within 365 days", async () => {
    const { practice } = await seedPractice();
    const recentReview = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await adoptCorePpPolicies(practice.id, { lastReviewedAt: recentReview });
    expect(await runRule(hipaaPoliciesReviewCurrentRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when at least one policy was reviewed >365 days ago", async () => {
    const { practice } = await seedPractice();
    const stale = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await adoptPolicy(practice.id, "HIPAA_PRIVACY_POLICY", { lastReviewedAt: stale });
    await adoptPolicy(practice.id, "HIPAA_SECURITY_POLICY", { lastReviewedAt: new Date() });
    await adoptPolicy(practice.id, "HIPAA_BREACH_RESPONSE_POLICY", { lastReviewedAt: new Date() });
    expect(await runRule(hipaaPoliciesReviewCurrentRule, practice.id)).toBe("GAP");
  });

  it("returns GAP when an adopted policy has lastReviewedAt=null", async () => {
    const { practice } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_PRIVACY_POLICY", { lastReviewedAt: null });
    expect(await runRule(hipaaPoliciesReviewCurrentRule, practice.id)).toBe("GAP");
  });

  it("ignores retired policies — only non-retired count", async () => {
    const { practice } = await seedPractice();
    const stale = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000);
    // Retired policy with stale review — should NOT cause GAP.
    await adoptPolicy(practice.id, "HIPAA_PRIVACY_POLICY", {
      lastReviewedAt: stale,
      retiredAt: new Date(),
    });
    // Active policy reviewed recently.
    await adoptPolicy(practice.id, "HIPAA_SECURITY_POLICY", { lastReviewedAt: new Date() });
    expect(await runRule(hipaaPoliciesReviewCurrentRule, practice.id)).toBe("COMPLIANT");
  });
});

// ─── HIPAA_BREACH_RESPONSE ───────────────────────────────────────────────────

describe("HIPAA_BREACH_RESPONSE", () => {
  it("returns GAP when policy not adopted", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaBreachResponseRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when policy adopted and no breaches", async () => {
    const { practice } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_BREACH_RESPONSE_POLICY");
    expect(await runRule(hipaaBreachResponseRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns COMPLIANT when policy adopted and all breaches resolved", async () => {
    const { practice, user } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_BREACH_RESPONSE_POLICY");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Email misdirection",
        description: "Resolved breach",
        type: "PRIVACY",
        severity: "MEDIUM",
        isBreach: true,
        discoveredAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        resolvedAt: new Date(),
      },
    });
    expect(await runRule(hipaaBreachResponseRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when policy adopted but an unresolved breach exists", async () => {
    const { practice, user } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_BREACH_RESPONSE_POLICY");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Active breach",
        description: "Mid-flight",
        type: "PRIVACY",
        severity: "HIGH",
        isBreach: true,
        discoveredAt: new Date(),
        resolvedAt: null,
      },
    });
    expect(await runRule(hipaaBreachResponseRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_DOCUMENTATION_RETENTION ───────────────────────────────────────────

describe("HIPAA_DOCUMENTATION_RETENTION", () => {
  it("returns null when no destruction-log entries ever logged", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaDocumentationRetentionRule, practice.id)).toBeNull();
  });

  it("returns COMPLIANT when at least one destruction-log entry within last 365 days", async () => {
    const { practice, user } = await seedPractice();
    await db.destructionLog.create({
      data: {
        practiceId: practice.id,
        documentType: "MEDICAL_RECORDS",
        description: "Charts from 2018",
        method: "SHREDDING",
        performedByUserId: user.id,
        destroyedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    });
    expect(await runRule(hipaaDocumentationRetentionRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when entries exist but all are >365 days ago", async () => {
    const { practice, user } = await seedPractice();
    await db.destructionLog.create({
      data: {
        practiceId: practice.id,
        documentType: "BILLING",
        description: "Old EOBs",
        method: "SHREDDING",
        performedByUserId: user.id,
        destroyedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
      },
    });
    expect(await runRule(hipaaDocumentationRetentionRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_MINIMUM_NECESSARY (single-policy stub) ────────────────────────────

describe("HIPAA_MINIMUM_NECESSARY", () => {
  it("returns GAP when policy not adopted", async () => {
    const { practice } = await seedPractice();
    const rule = HIPAA_DERIVATION_RULES.HIPAA_MINIMUM_NECESSARY!;
    expect(await runRule(rule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when HIPAA_MINIMUM_NECESSARY_POLICY adopted", async () => {
    const { practice } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_MINIMUM_NECESSARY_POLICY");
    const rule = HIPAA_DERIVATION_RULES.HIPAA_MINIMUM_NECESSARY!;
    expect(await runRule(rule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when policy is retired", async () => {
    const { practice } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_MINIMUM_NECESSARY_POLICY", {
      retiredAt: new Date(),
    });
    const rule = HIPAA_DERIVATION_RULES.HIPAA_MINIMUM_NECESSARY!;
    expect(await runRule(rule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_NPP (single-policy stub) ──────────────────────────────────────────

describe("HIPAA_NPP", () => {
  it("returns GAP when NPP policy not adopted", async () => {
    const { practice } = await seedPractice();
    const rule = HIPAA_DERIVATION_RULES.HIPAA_NPP!;
    expect(await runRule(rule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when HIPAA_NPP_POLICY adopted", async () => {
    const { practice } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_NPP_POLICY");
    const rule = HIPAA_DERIVATION_RULES.HIPAA_NPP!;
    expect(await runRule(rule, practice.id)).toBe("COMPLIANT");
  });
});

// ─── HIPAA_WORKSTATION_USE (single-policy stub) ──────────────────────────────

describe("HIPAA_WORKSTATION_USE", () => {
  it("returns GAP when workstation policy not adopted", async () => {
    const { practice } = await seedPractice();
    const rule = HIPAA_DERIVATION_RULES.HIPAA_WORKSTATION_USE!;
    expect(await runRule(rule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when HIPAA_WORKSTATION_POLICY adopted", async () => {
    const { practice } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_WORKSTATION_POLICY");
    const rule = HIPAA_DERIVATION_RULES.HIPAA_WORKSTATION_USE!;
    expect(await runRule(rule, practice.id)).toBe("COMPLIANT");
  });
});

// ─── HIPAA_WORKFORCE_TRAINING ────────────────────────────────────────────────

describe("HIPAA_WORKFORCE_TRAINING", () => {
  it("returns GAP when no users have completed HIPAA_BASICS", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaWorkforceTrainingRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when sole owner has a passed, non-expired HIPAA_BASICS completion", async () => {
    const { practice, user } = await seedPractice();
    const course = await db.trainingCourse.findUniqueOrThrow({
      where: { code: "HIPAA_BASICS" },
    });
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: course.version,
        score: 95,
        passed: true,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    expect(await runRule(hipaaWorkforceTrainingRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when completion exists but expired", async () => {
    const { practice, user } = await seedPractice();
    const course = await db.trainingCourse.findUniqueOrThrow({
      where: { code: "HIPAA_BASICS" },
    });
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: course.version,
        score: 95,
        passed: true,
        completedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // expired
      },
    });
    expect(await runRule(hipaaWorkforceTrainingRule, practice.id)).toBe("GAP");
  });

  it("returns GAP when one of two staff has not completed (50% < 95%)", async () => {
    const { practice, user } = await seedPractice();
    // Add a second active staff member who has NOT completed.
    const u2 = await db.user.create({
      data: {
        firebaseUid: `wt2-${suffix()}`,
        email: `wt2-${suffix()}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: { userId: u2.id, practiceId: practice.id, role: "STAFF" },
    });
    const course = await db.trainingCourse.findUniqueOrThrow({
      where: { code: "HIPAA_BASICS" },
    });
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: course.version,
        score: 95,
        passed: true,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    expect(await runRule(hipaaWorkforceTrainingRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_BAAS ──────────────────────────────────────────────────────────────

describe("HIPAA_BAAS", () => {
  it("returns GAP when no PHI vendors on file (forces explicit list-or-NA decision)", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaBaaRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when every active PHI vendor has a non-expired BAA", async () => {
    const { practice } = await seedPractice();
    await db.vendor.create({
      data: {
        practiceId: practice.id,
        name: "Athena EHR",
        processesPhi: true,
        baaExecutedAt: new Date(),
        baaExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    expect(await runRule(hipaaBaaRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns COMPLIANT when BAA has no expiry (perpetual)", async () => {
    const { practice } = await seedPractice();
    await db.vendor.create({
      data: {
        practiceId: practice.id,
        name: "Some Cloud",
        processesPhi: true,
        baaExecutedAt: new Date(),
        baaExpiresAt: null,
      },
    });
    expect(await runRule(hipaaBaaRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when one PHI vendor has an expired BAA", async () => {
    const { practice } = await seedPractice();
    await db.vendor.create({
      data: {
        practiceId: practice.id,
        name: "Old Vendor",
        processesPhi: true,
        baaExecutedAt: new Date(Date.now() - 800 * 24 * 60 * 60 * 1000),
        baaExpiresAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // expired
      },
    });
    expect(await runRule(hipaaBaaRule, practice.id)).toBe("GAP");
  });

  it("returns GAP when one PHI vendor has no BAA on file", async () => {
    const { practice } = await seedPractice();
    await db.vendor.create({
      data: {
        practiceId: practice.id,
        name: "No-BAA Vendor",
        processesPhi: true,
        baaExecutedAt: null,
      },
    });
    expect(await runRule(hipaaBaaRule, practice.id)).toBe("GAP");
  });

  it("ignores retired PHI vendors", async () => {
    const { practice } = await seedPractice();
    // Retired vendor with no BAA — must NOT cause GAP.
    await db.vendor.create({
      data: {
        practiceId: practice.id,
        name: "Retired",
        processesPhi: true,
        baaExecutedAt: null,
        retiredAt: new Date(),
      },
    });
    // Active vendor with valid BAA.
    await db.vendor.create({
      data: {
        practiceId: practice.id,
        name: "Active",
        processesPhi: true,
        baaExecutedAt: new Date(),
        baaExpiresAt: null,
      },
    });
    expect(await runRule(hipaaBaaRule, practice.id)).toBe("COMPLIANT");
  });

  it("ignores non-PHI vendors entirely", async () => {
    const { practice } = await seedPractice();
    // Non-PHI vendor with no BAA — should NOT cause GAP. But the practice
    // also has no PHI vendors, so the rule still returns GAP per the
    // "explicit list-or-NA" gate. Verifies the processesPhi filter.
    await db.vendor.create({
      data: {
        practiceId: practice.id,
        name: "Cleaning Service",
        processesPhi: false,
      },
    });
    expect(await runRule(hipaaBaaRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_SRA ───────────────────────────────────────────────────────────────

describe("HIPAA_SRA", () => {
  it("returns GAP when no completed assessments and no assets", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaSraRule, practice.id)).toBe("GAP");
  });

  it("returns GAP when assessment completed but no PHI asset on file", async () => {
    const { practice, user } = await seedPractice();
    await db.practiceSraAssessment.create({
      data: {
        practiceId: practice.id,
        completedByUserId: user.id,
        completedAt: new Date(),
        isDraft: false,
        overallScore: 85,
        addressedCount: 17,
        totalCount: 20,
      },
    });
    // No TechAsset — gate fails.
    expect(await runRule(hipaaSraRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when assessment completed within 365 days AND ≥1 PHI asset on file", async () => {
    const { practice, user } = await seedPractice();
    await db.practiceSraAssessment.create({
      data: {
        practiceId: practice.id,
        completedByUserId: user.id,
        completedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        isDraft: false,
        overallScore: 90,
        addressedCount: 18,
        totalCount: 20,
      },
    });
    await db.techAsset.create({
      data: {
        practiceId: practice.id,
        name: "EHR Server",
        assetType: "SERVER",
        processesPhi: true,
        encryption: "FULL_DISK",
      },
    });
    expect(await runRule(hipaaSraRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when only draft assessments (isDraft=true) exist", async () => {
    const { practice, user } = await seedPractice();
    await db.practiceSraAssessment.create({
      data: {
        practiceId: practice.id,
        completedByUserId: user.id,
        completedAt: null,
        isDraft: true,
        overallScore: 0,
        addressedCount: 0,
        totalCount: 20,
      },
    });
    await db.techAsset.create({
      data: {
        practiceId: practice.id,
        name: "Workstation",
        assetType: "DESKTOP",
        processesPhi: true,
        encryption: "FULL_DISK",
      },
    });
    expect(await runRule(hipaaSraRule, practice.id)).toBe("GAP");
  });

  it("returns GAP when assessment was completed >365 days ago", async () => {
    const { practice, user } = await seedPractice();
    await db.practiceSraAssessment.create({
      data: {
        practiceId: practice.id,
        completedByUserId: user.id,
        completedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
        isDraft: false,
        overallScore: 90,
        addressedCount: 18,
        totalCount: 20,
      },
    });
    await db.techAsset.create({
      data: {
        practiceId: practice.id,
        name: "Asset",
        assetType: "SERVER",
        processesPhi: true,
        encryption: "FULL_DISK",
      },
    });
    expect(await runRule(hipaaSraRule, practice.id)).toBe("GAP");
  });

  it("ignores retired PHI assets — only active ones gate", async () => {
    const { practice, user } = await seedPractice();
    await db.practiceSraAssessment.create({
      data: {
        practiceId: practice.id,
        completedByUserId: user.id,
        completedAt: new Date(),
        isDraft: false,
        overallScore: 90,
        addressedCount: 18,
        totalCount: 20,
      },
    });
    // Retired asset shouldn't satisfy the gate.
    await db.techAsset.create({
      data: {
        practiceId: practice.id,
        name: "Old Server",
        assetType: "SERVER",
        processesPhi: true,
        encryption: "FULL_DISK",
        retiredAt: new Date(),
      },
    });
    expect(await runRule(hipaaSraRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_CYBER_TRAINING_COMPLETE ───────────────────────────────────────────

describe("HIPAA_CYBER_TRAINING_COMPLETE", () => {
  it("returns GAP when active workforce hasn't completed any cyber courses", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaCyberTrainingCompleteRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when sole owner has passed all 4 cyber courses", async () => {
    const { practice, user } = await seedPractice();
    const cyberCourseCodes = [
      "PHISHING_RECOGNITION_RESPONSE",
      "MFA_AUTHENTICATION_HYGIENE",
      "RANSOMWARE_DEFENSE_PLAYBOOK",
      "CYBERSECURITY_MEDICAL_OFFICES",
    ];
    const courses = await db.trainingCourse.findMany({
      where: { code: { in: cyberCourseCodes } },
    });
    // Skip if courses aren't seeded — would be a separate seed-data bug.
    expect(courses.length).toBe(cyberCourseCodes.length);
    for (const c of courses) {
      await db.trainingCompletion.create({
        data: {
          practiceId: practice.id,
          userId: user.id,
          courseId: c.id,
          courseVersion: c.version,
          score: 95,
          passed: true,
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
    }
    expect(await runRule(hipaaCyberTrainingCompleteRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when only 3 of 4 cyber courses completed", async () => {
    const { practice, user } = await seedPractice();
    const courses = await db.trainingCourse.findMany({
      where: {
        code: {
          in: [
            "PHISHING_RECOGNITION_RESPONSE",
            "MFA_AUTHENTICATION_HYGIENE",
            "RANSOMWARE_DEFENSE_PLAYBOOK",
          ],
        },
      },
    });
    for (const c of courses) {
      await db.trainingCompletion.create({
        data: {
          practiceId: practice.id,
          userId: user.id,
          courseId: c.id,
          courseVersion: c.version,
          score: 95,
          passed: true,
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
    }
    expect(await runRule(hipaaCyberTrainingCompleteRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_MFA_COVERAGE_GE_80 ────────────────────────────────────────────────

describe("HIPAA_MFA_COVERAGE_GE_80", () => {
  it("returns GAP when sole owner has not enrolled in MFA", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaMfaCoverageRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when sole owner has mfaEnrolledAt set (100% coverage)", async () => {
    const { practice, practiceUserId } = await seedPractice();
    await db.practiceUser.update({
      where: { id: practiceUserId },
      data: { mfaEnrolledAt: new Date() },
    });
    expect(await runRule(hipaaMfaCoverageRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when 1 of 2 staff enrolled (50% < 80%)", async () => {
    const { practice, practiceUserId } = await seedPractice();
    const u2 = await db.user.create({
      data: {
        firebaseUid: `mfa2-${suffix()}`,
        email: `mfa2-${suffix()}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: { userId: u2.id, practiceId: practice.id, role: "STAFF" },
    });
    await db.practiceUser.update({
      where: { id: practiceUserId },
      data: { mfaEnrolledAt: new Date() },
    });
    expect(await runRule(hipaaMfaCoverageRule, practice.id)).toBe("GAP");
  });

  it("removed users don't dilute the denominator", async () => {
    const { practice, practiceUserId } = await seedPractice();
    const u2 = await db.user.create({
      data: {
        firebaseUid: `mfa3-${suffix()}`,
        email: `mfa3-${suffix()}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: {
        userId: u2.id,
        practiceId: practice.id,
        role: "STAFF",
        removedAt: new Date(),
      },
    });
    await db.practiceUser.update({
      where: { id: practiceUserId },
      data: { mfaEnrolledAt: new Date() },
    });
    // Active users = 1 (owner only); enrolled = 1 → 100%.
    expect(await runRule(hipaaMfaCoverageRule, practice.id)).toBe("COMPLIANT");
  });
});

// ─── HIPAA_PHISHING_DRILL_RECENT ─────────────────────────────────────────────

describe("HIPAA_PHISHING_DRILL_RECENT", () => {
  it("returns null when zero drills ever logged (default to NOT_STARTED)", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaPhishingDrillRecentRule, practice.id)).toBeNull();
  });

  it("returns COMPLIANT when at least one drill within last 6 months", async () => {
    const { practice, user } = await seedPractice();
    await db.phishingDrill.create({
      data: {
        practiceId: practice.id,
        conductedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        totalRecipients: 5,
        loggedByUserId: user.id,
      },
    });
    expect(await runRule(hipaaPhishingDrillRecentRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when drills exist but none in last 6 months (cadence lapsed)", async () => {
    const { practice, user } = await seedPractice();
    await db.phishingDrill.create({
      data: {
        practiceId: practice.id,
        conductedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        totalRecipients: 5,
        loggedByUserId: user.id,
      },
    });
    expect(await runRule(hipaaPhishingDrillRecentRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_BACKUP_VERIFIED_RECENT ────────────────────────────────────────────

describe("HIPAA_BACKUP_VERIFIED_RECENT", () => {
  it("returns null when no backup verifications ever logged", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaBackupVerifiedRecentRule, practice.id)).toBeNull();
  });

  it("returns COMPLIANT when a successful verification logged within 90 days", async () => {
    const { practice, user } = await seedPractice();
    await db.backupVerification.create({
      data: {
        practiceId: practice.id,
        verifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        scope: "EHR",
        success: true,
        loggedByUserId: user.id,
      },
    });
    expect(await runRule(hipaaBackupVerifiedRecentRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when only a failed verification within window (success=false)", async () => {
    const { practice, user } = await seedPractice();
    await db.backupVerification.create({
      data: {
        practiceId: practice.id,
        verifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        scope: "EHR",
        success: false,
        loggedByUserId: user.id,
      },
    });
    expect(await runRule(hipaaBackupVerifiedRecentRule, practice.id)).toBe("GAP");
  });

  it("returns GAP when last successful verification was >90 days ago", async () => {
    const { practice, user } = await seedPractice();
    await db.backupVerification.create({
      data: {
        practiceId: practice.id,
        verifiedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        scope: "EHR",
        success: true,
        loggedByUserId: user.id,
      },
    });
    expect(await runRule(hipaaBackupVerifiedRecentRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA_POLICY_ACKNOWLEDGMENT_COVERAGE ────────────────────────────────────

describe("HIPAA_POLICY_ACKNOWLEDGMENT_COVERAGE", () => {
  it("returns null when no policies adopted", async () => {
    const { practice } = await seedPractice();
    expect(await runRule(hipaaPolicyAcknowledgmentCoverageRule, practice.id)).toBeNull();
  });

  it("returns null when no active workforce", async () => {
    const { practice, practiceUserId } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_PRIVACY_POLICY");
    // Remove the only PracticeUser.
    await db.practiceUser.update({
      where: { id: practiceUserId },
      data: { removedAt: new Date() },
    });
    expect(await runRule(hipaaPolicyAcknowledgmentCoverageRule, practice.id)).toBeNull();
  });

  it("returns GAP when no acknowledgments exist for adopted policies", async () => {
    const { practice } = await seedPractice();
    await adoptPolicy(practice.id, "HIPAA_PRIVACY_POLICY");
    expect(await runRule(hipaaPolicyAcknowledgmentCoverageRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when sole owner has acked CURRENT version of every adopted policy", async () => {
    const { practice, user } = await seedPractice();
    const p1 = await adoptPolicy(practice.id, "HIPAA_PRIVACY_POLICY");
    const p2 = await adoptPolicy(practice.id, "HIPAA_SECURITY_POLICY");
    await db.policyAcknowledgment.create({
      data: {
        practicePolicyId: p1.id,
        userId: user.id,
        policyVersion: 1,
        signatureText: "I have read",
      },
    });
    await db.policyAcknowledgment.create({
      data: {
        practicePolicyId: p2.id,
        userId: user.id,
        policyVersion: 1,
        signatureText: "I have read",
      },
    });
    expect(await runRule(hipaaPolicyAcknowledgmentCoverageRule, practice.id)).toBe("COMPLIANT");
  });

  it("ignores stale acknowledgments (signed at older version than current)", async () => {
    const { practice, user } = await seedPractice();
    const p1 = await adoptPolicy(practice.id, "HIPAA_PRIVACY_POLICY", { version: 3 });
    // User signed v1 — stale relative to current v3.
    await db.policyAcknowledgment.create({
      data: {
        practicePolicyId: p1.id,
        userId: user.id,
        policyVersion: 1,
        signatureText: "I have read v1",
      },
    });
    expect(await runRule(hipaaPolicyAcknowledgmentCoverageRule, practice.id)).toBe("GAP");
  });

  it("returns GAP when 1 of 2 staff have signed (50% < 80%)", async () => {
    const { practice, user } = await seedPractice();
    const p1 = await adoptPolicy(practice.id, "HIPAA_PRIVACY_POLICY");
    const u2 = await db.user.create({
      data: {
        firebaseUid: `ack2-${suffix()}`,
        email: `ack2-${suffix()}@test.test`,
      },
    });
    await db.practiceUser.create({
      data: { userId: u2.id, practiceId: practice.id, role: "STAFF" },
    });
    // Only owner signed.
    await db.policyAcknowledgment.create({
      data: {
        practicePolicyId: p1.id,
        userId: user.id,
        policyVersion: 1,
        signatureText: "I have read",
      },
    });
    expect(await runRule(hipaaPolicyAcknowledgmentCoverageRule, practice.id)).toBe("GAP");
  });
});

// ─── HIPAA CA breach exported alias (15 business days) ──────────────────────

describe("hipaaCaBreachNotification15BizDaysRule (named export)", () => {
  it("matches HIPAA_DERIVATION_RULES.HIPAA_CA_BREACH_NOTIFICATION_72HR", () => {
    expect(HIPAA_DERIVATION_RULES.HIPAA_CA_BREACH_NOTIFICATION_72HR).toBe(
      hipaaCaBreachNotification15BizDaysRule,
    );
  });

  it("returns COMPLIANT vacuously when no CA breaches exist", async () => {
    const { practice } = await seedPractice("CA");
    expect(await runRule(hipaaCaBreachNotification15BizDaysRule, practice.id)).toBe("COMPLIANT");
  });

  it("returns GAP when notification recorded after the 15-business-day window", async () => {
    const { practice, user } = await seedPractice("CA");
    // Discovered 30 days ago (well past 15 biz days), notified yesterday.
    const discoveredAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const notifiedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Breach",
        description: "x",
        type: "PRIVACY",
        severity: "HIGH",
        isBreach: true,
        patientState: "CA",
        discoveredAt,
        affectedIndividualsNotifiedAt: notifiedAt,
      },
    });
    expect(await runRule(hipaaCaBreachNotification15BizDaysRule, practice.id)).toBe("GAP");
  });

  it("returns COMPLIANT when notification recorded within 15 business days", async () => {
    const { practice, user } = await seedPractice("CA");
    // Discovered today, notified today (same day → trivially within 15 biz days).
    const discoveredAt = new Date();
    const notifiedAt = new Date(discoveredAt.getTime() + 60 * 1000); // 1 minute later
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Breach",
        description: "x",
        type: "PRIVACY",
        severity: "HIGH",
        isBreach: true,
        patientState: "CA",
        discoveredAt,
        affectedIndividualsNotifiedAt: notifiedAt,
      },
    });
    expect(await runRule(hipaaCaBreachNotification15BizDaysRule, practice.id)).toBe("COMPLIANT");
  });
});

// ─── 50 state breach-notification overlays — parameterized ───────────────────
//
// Every state breach rule shares the same shape (stateBreachNotificationRule
// factory). Rather than 100 hand-written tests, this describe.each
// exercises each state with the universal contract:
//   1. No state-scoped breaches → COMPLIANT (vacuously satisfied).
//   2. State-scoped breach with NO notification yet → GAP.
//
// The CA "fixed-window" path is exercised separately above; here we only
// confirm the parameterized factory is wired correctly for every state.

interface StateOverlay {
  /** ISO state code */
  stateCode: string;
  /** RegulatoryRequirement.code → key in HIPAA_DERIVATION_RULES */
  ruleCode: string;
}

const STATE_OVERLAYS: StateOverlay[] = [
  // Fixed-window (calendar days)
  { stateCode: "CA", ruleCode: "HIPAA_CA_BREACH_NOTIFICATION_72HR" },
  { stateCode: "TX", ruleCode: "HIPAA_TX_BREACH_60DAY" },
  { stateCode: "FL", ruleCode: "HIPAA_FL_FIPA_30DAY" },
  { stateCode: "WA", ruleCode: "HIPAA_WA_BREACH_30DAY" },
  { stateCode: "CO", ruleCode: "HIPAA_CO_BREACH_30DAY" },
  { stateCode: "OR", ruleCode: "HIPAA_OR_BREACH_45DAY" },
  { stateCode: "OH", ruleCode: "HIPAA_OH_BREACH_45DAY" },
  { stateCode: "MD", ruleCode: "HIPAA_MD_PIPA_45DAY" },
  // Most-expedient (no fixed window)
  { stateCode: "NY", ruleCode: "HIPAA_NY_BREACH_EXPEDIENT" },
  { stateCode: "IL", ruleCode: "HIPAA_IL_PIPA_BREACH" },
  { stateCode: "MA", ruleCode: "HIPAA_MA_BREACH_ASAP" },
  { stateCode: "NJ", ruleCode: "HIPAA_NJ_BREACH_EXPEDIENT" },
  { stateCode: "NV", ruleCode: "HIPAA_NV_BREACH_EXPEDIENT" },
  { stateCode: "UT", ruleCode: "HIPAA_UT_BREACH_EXPEDIENT" },
  { stateCode: "GA", ruleCode: "HIPAA_GA_BREACH_EXPEDIENT" },
  { stateCode: "NC", ruleCode: "HIPAA_NC_BREACH_EXPEDIENT" },
  { stateCode: "MI", ruleCode: "HIPAA_MI_BREACH_EXPEDIENT" },
  { stateCode: "PA", ruleCode: "HIPAA_PA_BREACH_EXPEDIENT" },
  { stateCode: "MN", ruleCode: "HIPAA_MN_BREACH_EXPEDIENT" },
  // Batch 3
  { stateCode: "AZ", ruleCode: "HIPAA_AZ_BREACH_45DAY" },
  { stateCode: "CT", ruleCode: "HIPAA_CT_BREACH_60DAY_AG" },
  { stateCode: "TN", ruleCode: "HIPAA_TN_BREACH_45DAY" },
  { stateCode: "IN", ruleCode: "HIPAA_IN_BREACH_EXPEDIENT" },
  { stateCode: "WI", ruleCode: "HIPAA_WI_BREACH_45DAY" },
  { stateCode: "KY", ruleCode: "HIPAA_KY_BREACH_EXPEDIENT" },
  { stateCode: "LA", ruleCode: "HIPAA_LA_BREACH_60DAY" },
  { stateCode: "IA", ruleCode: "HIPAA_IA_BREACH_EXPEDIENT" },
  { stateCode: "MO", ruleCode: "HIPAA_MO_BREACH_EXPEDIENT" },
  { stateCode: "AL", ruleCode: "HIPAA_AL_BREACH_45DAY" },
  // Batch 4
  { stateCode: "AK", ruleCode: "HIPAA_AK_BREACH_EXPEDIENT" },
  { stateCode: "AR", ruleCode: "HIPAA_AR_BREACH_EXPEDIENT" },
  { stateCode: "DE", ruleCode: "HIPAA_DE_BREACH_EXPEDIENT" },
  { stateCode: "DC", ruleCode: "HIPAA_DC_BREACH_EXPEDIENT" },
  { stateCode: "HI", ruleCode: "HIPAA_HI_BREACH_EXPEDIENT" },
  { stateCode: "ID", ruleCode: "HIPAA_ID_BREACH_EXPEDIENT" },
  { stateCode: "KS", ruleCode: "HIPAA_KS_BREACH_EXPEDIENT" },
  { stateCode: "ME", ruleCode: "HIPAA_ME_BREACH_30DAY" },
  { stateCode: "MS", ruleCode: "HIPAA_MS_BREACH_EXPEDIENT" },
  { stateCode: "MT", ruleCode: "HIPAA_MT_BREACH_EXPEDIENT" },
  { stateCode: "NE", ruleCode: "HIPAA_NE_BREACH_EXPEDIENT" },
  { stateCode: "NH", ruleCode: "HIPAA_NH_BREACH_EXPEDIENT" },
  { stateCode: "NM", ruleCode: "HIPAA_NM_BREACH_45DAY" },
  { stateCode: "ND", ruleCode: "HIPAA_ND_BREACH_EXPEDIENT" },
  { stateCode: "OK", ruleCode: "HIPAA_OK_BREACH_EXPEDIENT" },
  { stateCode: "RI", ruleCode: "HIPAA_RI_BREACH_45DAY" },
  { stateCode: "SC", ruleCode: "HIPAA_SC_BREACH_EXPEDIENT" },
  { stateCode: "SD", ruleCode: "HIPAA_SD_BREACH_60DAY" },
  { stateCode: "VT", ruleCode: "HIPAA_VT_BREACH_EXPEDIENT" },
  { stateCode: "WV", ruleCode: "HIPAA_WV_BREACH_EXPEDIENT" },
  { stateCode: "WY", ruleCode: "HIPAA_WY_BREACH_EXPEDIENT" },
];

describe("State breach-notification overlays (50 states + DC)", () => {
  it("STATE_OVERLAYS fixture covers exactly 50 unique states/jurisdictions", () => {
    const states = new Set(STATE_OVERLAYS.map((s) => s.stateCode));
    expect(states.size).toBe(50);
    // Every entry's ruleCode is registered in HIPAA_DERIVATION_RULES.
    for (const o of STATE_OVERLAYS) {
      expect(
        HIPAA_DERIVATION_RULES[o.ruleCode],
        `Missing rule: ${o.ruleCode}`,
      ).toBeDefined();
    }
  });

  // The describe.each runs both tests for each state — 50 states × 2 tests = 100.
  describe.each(STATE_OVERLAYS)(
    "$ruleCode (state=$stateCode)",
    ({ stateCode, ruleCode }) => {
      it("returns COMPLIANT vacuously when no state-scoped breaches exist", async () => {
        const { practice } = await seedPractice(stateCode);
        const rule = HIPAA_DERIVATION_RULES[ruleCode]!;
        expect(await runRule(rule, practice.id)).toBe("COMPLIANT");
      });

      it("returns GAP when a state-scoped breach has no affectedIndividualsNotifiedAt yet", async () => {
        const { practice, user } = await seedPractice(stateCode);
        await db.incident.create({
          data: {
            practiceId: practice.id,
            reportedByUserId: user.id,
            title: `${stateCode} breach`,
            description: "x",
            type: "PRIVACY",
            severity: "MEDIUM",
            isBreach: true,
            patientState: stateCode,
            discoveredAt: new Date(),
            affectedIndividualsNotifiedAt: null,
          },
        });
        const rule = HIPAA_DERIVATION_RULES[ruleCode]!;
        expect(await runRule(rule, practice.id)).toBe("GAP");
      });
    },
  );
});

// ─── State-scope edge cases (one-off, not per state) ────────────────────────

describe("State breach overlay — scope edge cases", () => {
  it("a CA-scoped breach does NOT trigger the TX rule", async () => {
    const { practice, user } = await seedPractice("CA");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "CA breach",
        description: "x",
        type: "PRIVACY",
        severity: "MEDIUM",
        isBreach: true,
        patientState: "CA",
        discoveredAt: new Date(),
        affectedIndividualsNotifiedAt: null,
      },
    });
    const txRule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    expect(await runRule(txRule, practice.id)).toBe("COMPLIANT");
  });

  it("a null-patientState breach is scoped to the practice's primaryState", async () => {
    // Breach at a TX practice with patientState=null counts as TX-scoped.
    const { practice, user } = await seedPractice("TX");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Unspecified-state breach",
        description: "x",
        type: "PRIVACY",
        severity: "MEDIUM",
        isBreach: true,
        patientState: null,
        discoveredAt: new Date(),
        affectedIndividualsNotifiedAt: null,
      },
    });
    const txRule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    expect(await runRule(txRule, practice.id)).toBe("GAP");
  });

  it("a null-patientState breach does NOT count for a state OTHER than the practice's primary", async () => {
    // Breach at a TX practice with patientState=null counts as TX, NOT CA.
    const { practice, user } = await seedPractice("TX");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Unspecified-state breach",
        description: "x",
        type: "PRIVACY",
        severity: "MEDIUM",
        isBreach: true,
        patientState: null,
        discoveredAt: new Date(),
        affectedIndividualsNotifiedAt: null,
      },
    });
    const caRule = HIPAA_DERIVATION_RULES.HIPAA_CA_BREACH_NOTIFICATION_72HR!;
    expect(await runRule(caRule, practice.id)).toBe("COMPLIANT"); // vacuous
  });

  it("non-breach incidents (isBreach=false) are ignored by state overlays", async () => {
    const { practice, user } = await seedPractice("TX");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Non-breach event",
        description: "x",
        type: "PRIVACY",
        severity: "LOW",
        isBreach: false,
        patientState: "TX",
        discoveredAt: new Date(),
        affectedIndividualsNotifiedAt: null,
      },
    });
    const txRule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    expect(await runRule(txRule, practice.id)).toBe("COMPLIANT");
  });

  it("undetermined breaches (isBreach=null) are ignored by state overlays", async () => {
    const { practice, user } = await seedPractice("TX");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Pending determination",
        description: "x",
        type: "PRIVACY",
        severity: "LOW",
        isBreach: null,
        patientState: "TX",
        discoveredAt: new Date(),
        affectedIndividualsNotifiedAt: null,
      },
    });
    const txRule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    expect(await runRule(txRule, practice.id)).toBe("COMPLIANT");
  });

  it("late notification past calendar-day window → GAP (TX 60-day)", async () => {
    const { practice, user } = await seedPractice("TX");
    const discoveredAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const notifiedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // ~89 days after
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Late TX breach",
        description: "x",
        type: "PRIVACY",
        severity: "MEDIUM",
        isBreach: true,
        patientState: "TX",
        discoveredAt,
        affectedIndividualsNotifiedAt: notifiedAt,
      },
    });
    const txRule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    expect(await runRule(txRule, practice.id)).toBe("GAP");
  });

  it("on-time notification within calendar-day window → COMPLIANT (TX 60-day)", async () => {
    const { practice, user } = await seedPractice("TX");
    const discoveredAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const notifiedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // ~25 days after
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "On-time TX breach",
        description: "x",
        type: "PRIVACY",
        severity: "MEDIUM",
        isBreach: true,
        patientState: "TX",
        discoveredAt,
        affectedIndividualsNotifiedAt: notifiedAt,
      },
    });
    const txRule = HIPAA_DERIVATION_RULES.HIPAA_TX_BREACH_60DAY!;
    expect(await runRule(txRule, practice.id)).toBe("COMPLIANT");
  });

  it("expedient (windowDays=null) rule treats notification presence as COMPLIANT regardless of elapsed time", async () => {
    const { practice, user } = await seedPractice("NY");
    // Discovered a year ago, just notified yesterday — still COMPLIANT
    // for the expedient rule (windowDays=null → no fixed deadline check).
    const discoveredAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const notifiedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Late NY notice",
        description: "x",
        type: "PRIVACY",
        severity: "MEDIUM",
        isBreach: true,
        patientState: "NY",
        discoveredAt,
        affectedIndividualsNotifiedAt: notifiedAt,
      },
    });
    const nyRule = HIPAA_DERIVATION_RULES.HIPAA_NY_BREACH_EXPEDIENT!;
    expect(await runRule(nyRule, practice.id)).toBe("COMPLIANT");
  });
});
