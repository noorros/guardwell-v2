// tests/integration/role-gate-sweep.test.ts
//
// Audit C-2 cross-area sweep (HIPAA + OSHA + Credentials + Allergy code
// reviews, 2026-04-29). Verifies that the actions and API routes flagged
// as "MEMBER/STAFF/VIEWER could exploit" now correctly reject
// non-OWNER/non-ADMIN callers — and that the deliberately-open paths
// (incident report, policy ack, allergy quiz submission) remain open.
//
// Audit batch-2 (2026-04-30): seven additional sites flagged in the
// cross-area audit follow-up. Tests appended at the bottom of the
// describe block, mirroring the existing STAFF-rejection patterns.
//
// Coverage:
//   Credentials
//     - addCredentialAction (STAFF rejected, OWNER allowed)
//     - removeCredentialAction (STAFF rejected)
//     - GET /api/credentials/export (STAFF 403, OWNER 200)
//   Allergy
//     - attestFingertipTestAction per-target tenant check
//     - attestMediaFillTestAction per-target tenant check
//   HIPAA — staff
//     - toggleOfficerAction (STAFF rejected, ADMIN rejected, OWNER allowed)
//   HIPAA — incidents
//     - completeBreachDeterminationAction (STAFF rejected)
//     - resolveIncidentAction (STAFF rejected)
//     - recordIncidentNotificationAction (STAFF rejected)
//     - reportIncidentAction (STAFF intentionally ALLOWED)
//   HIPAA — policies
//     - adoptPolicyAction (STAFF rejected)
//     - retirePolicyAction (STAFF rejected)
//     - updatePolicyContentAction (STAFF rejected)
//     - acknowledgePolicyAction (STAFF intentionally ALLOWED)
//   OSHA — PDF routes
//     - GET /api/audit/osha-300 (STAFF 403, OWNER 200)
//     - GET /api/audit/osha-301/[id] (STAFF 403)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  var __roleSweepTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__roleSweepTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__roleSweepTestUser) throw new Error("Unauthorized");
      return globalThis.__roleSweepTestUser;
    },
  };
});

// `revalidatePath` requires Next.js's static-generation store, which
// isn't available in vitest. Stub it out — the test only cares about
// the auth gate, not cache revalidation.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__roleSweepTestUser = null;
});

async function seed(role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER") {
  const user = await db.user.create({
    data: {
      firebaseUid: `rg-${Math.random().toString(36).slice(2, 10)}`,
      email: `rg-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `RG ${role} Practice`, primaryState: "AZ" },
  });
  // Always seed an OWNER first so the practice has a captain (the
  // schema doesn't enforce, but actions sometimes assume an OWNER
  // exists for the practiceId scoping).
  const ownerUser = await db.user.create({
    data: {
      firebaseUid: `rg-owner-${Math.random().toString(36).slice(2, 10)}`,
      email: `rg-owner-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  await db.practiceUser.create({
    data: { userId: ownerUser.id, practiceId: practice.id, role: "OWNER" },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role },
  });
  globalThis.__roleSweepTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice, pu, ownerUser };
}

describe("Audit C-2 role-gate sweep", () => {
  // ────────────────────────────────────────────────────────────────────
  // Credentials C-2: addCredentialAction
  // ────────────────────────────────────────────────────────────────────

  it("addCredentialAction rejects STAFF callers", async () => {
    await seed("STAFF");
    const credType = await db.credentialType.upsert({
      where: { code: "RG_TEST_TYPE_ADD_STAFF" },
      update: {},
      create: {
        code: "RG_TEST_TYPE_ADD_STAFF",
        name: "RG Test Type",
        category: "CLINICAL_LICENSE",
      },
    });
    const { addCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      addCredentialAction({
        credentialTypeCode: credType.code,
        holderId: null,
        title: "Pwned by STAFF",
        licenseNumber: null,
        issuingBody: null,
        issueDate: null,
        expiryDate: null,
        notes: null,
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("addCredentialAction allows OWNER callers", async () => {
    await seed("OWNER");
    const credType = await db.credentialType.upsert({
      where: { code: "RG_TEST_TYPE_ADD_OWNER" },
      update: {},
      create: {
        code: "RG_TEST_TYPE_ADD_OWNER",
        name: "RG Test Type Owner",
        category: "CLINICAL_LICENSE",
      },
    });
    const { addCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      addCredentialAction({
        credentialTypeCode: credType.code,
        holderId: null,
        title: "Owner-added credential",
        licenseNumber: null,
        issuingBody: null,
        issueDate: null,
        expiryDate: null,
        notes: null,
      }),
    ).resolves.not.toThrow();
  });

  // ────────────────────────────────────────────────────────────────────
  // Credentials C-2: removeCredentialAction
  // ────────────────────────────────────────────────────────────────────

  it("removeCredentialAction rejects STAFF callers", async () => {
    const { practice } = await seed("STAFF");
    const credType = await db.credentialType.upsert({
      where: { code: "RG_TEST_TYPE_RM_STAFF" },
      update: {},
      create: {
        code: "RG_TEST_TYPE_RM_STAFF",
        name: "RG Test Type RM",
        category: "CLINICAL_LICENSE",
      },
    });
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: credType.id,
        title: "Existing credential",
      },
    });
    const { removeCredentialAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );
    await expect(
      removeCredentialAction({ credentialId: cred.id }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  // ────────────────────────────────────────────────────────────────────
  // Credentials C-3: GET /api/credentials/export role gate
  // ────────────────────────────────────────────────────────────────────

  it("GET /api/credentials/export rejects STAFF callers (returns 403)", async () => {
    await seed("STAFF");
    const { GET } = await import("@/app/api/credentials/export/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("GET /api/credentials/export allows OWNER callers (returns 200)", async () => {
    await seed("OWNER");
    const { GET } = await import("@/app/api/credentials/export/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });

  // ────────────────────────────────────────────────────────────────────
  // Allergy C-2: per-target tenant check on attest actions
  // ────────────────────────────────────────────────────────────────────

  it("attestFingertipTestAction rejects targeting a practiceUser from another practice", async () => {
    await seed("OWNER");
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `other-${Math.random().toString(36).slice(2, 10)}`,
        email: `other-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice", primaryState: "TX" },
    });
    const otherPu = await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "STAFF" },
    });

    const { attestFingertipTestAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      attestFingertipTestAction({
        practiceUserId: otherPu.id,
        notes: null,
      }),
    ).rejects.toThrow(/not found|different practice/i);
  });

  it("attestMediaFillTestAction rejects targeting a practiceUser from another practice", async () => {
    await seed("OWNER");
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `other-mf-${Math.random().toString(36).slice(2, 10)}`,
        email: `other-mf-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice MF", primaryState: "TX" },
    });
    const otherPu = await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "STAFF" },
    });

    const { attestMediaFillTestAction } = await import(
      "@/app/(dashboard)/programs/allergy/actions"
    );
    await expect(
      attestMediaFillTestAction({
        practiceUserId: otherPu.id,
        notes: null,
      }),
    ).rejects.toThrow(/not found|different practice/i);
  });

  // ────────────────────────────────────────────────────────────────────
  // HIPAA C-2: toggleOfficerAction (OWNER required)
  // ────────────────────────────────────────────────────────────────────

  it("toggleOfficerAction rejects STAFF callers", async () => {
    const { practice } = await seed("STAFF");
    // Need a target PracticeUser in the same practice to designate.
    const targetUser = await db.user.create({
      data: {
        firebaseUid: `tgt-${Math.random().toString(36).slice(2, 10)}`,
        email: `tgt-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const target = await db.practiceUser.create({
      data: { userId: targetUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const { toggleOfficerAction } = await import(
      "@/app/(dashboard)/programs/staff/actions"
    );
    await expect(
      toggleOfficerAction({
        practiceUserId: target.id,
        officerRole: "PRIVACY",
        designated: true,
      }),
    ).rejects.toThrow(/owner|requires/i);
  });

  it("toggleOfficerAction rejects ADMIN callers (OWNER required)", async () => {
    const { practice } = await seed("ADMIN");
    const targetUser = await db.user.create({
      data: {
        firebaseUid: `tgt2-${Math.random().toString(36).slice(2, 10)}`,
        email: `tgt2-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const target = await db.practiceUser.create({
      data: { userId: targetUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const { toggleOfficerAction } = await import(
      "@/app/(dashboard)/programs/staff/actions"
    );
    await expect(
      toggleOfficerAction({
        practiceUserId: target.id,
        officerRole: "PRIVACY",
        designated: true,
      }),
    ).rejects.toThrow(/owner|requires/i);
  });

  it("toggleOfficerAction allows OWNER callers", async () => {
    const { practice } = await seed("OWNER");
    const targetUser = await db.user.create({
      data: {
        firebaseUid: `tgt3-${Math.random().toString(36).slice(2, 10)}`,
        email: `tgt3-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const target = await db.practiceUser.create({
      data: { userId: targetUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const { toggleOfficerAction } = await import(
      "@/app/(dashboard)/programs/staff/actions"
    );
    await expect(
      toggleOfficerAction({
        practiceUserId: target.id,
        officerRole: "PRIVACY",
        designated: true,
      }),
    ).resolves.not.toThrow();
  });

  // ────────────────────────────────────────────────────────────────────
  // HIPAA C-2: incident actions (ADMIN required, except report)
  // ────────────────────────────────────────────────────────────────────

  it("reportIncidentAction is intentionally OPEN to STAFF callers", async () => {
    await seed("STAFF");
    const { reportIncidentAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      reportIncidentAction({
        title: "Spilled coffee on workstation",
        description: "Staff member discovered a HIPAA-relevant exposure.",
        type: "PRIVACY",
        severity: "LOW",
        phiInvolved: false,
        affectedCount: null,
        discoveredAt: new Date().toISOString(),
        patientState: null,
        oshaBodyPart: null,
        oshaInjuryNature: null,
        oshaOutcome: null,
        oshaDaysAway: null,
        oshaDaysRestricted: null,
        sharpsDeviceType: null,
      }),
    ).resolves.toMatchObject({ incidentId: expect.any(String) });
  });

  it("completeBreachDeterminationAction rejects STAFF callers", async () => {
    const { practice, ownerUser } = await seed("STAFF");
    // Seed an incident to determine.
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Test incident",
        description: "Test description",
        type: "PRIVACY",
        severity: "MEDIUM",
        phiInvolved: true,
        discoveredAt: new Date(),
        reportedByUserId: ownerUser.id,
      },
    });
    const { completeBreachDeterminationAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      completeBreachDeterminationAction({
        incidentId: incident.id,
        factor1Score: 1,
        factor2Score: 1,
        factor3Score: 1,
        factor4Score: 1,
        affectedCount: 0,
        memoText:
          "Staff attempted to mark this as not-a-breach to mask the timeline.",
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("resolveIncidentAction rejects STAFF callers", async () => {
    const { practice, ownerUser } = await seed("STAFF");
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Test incident",
        description: "Test description",
        type: "PRIVACY",
        severity: "MEDIUM",
        phiInvolved: false,
        discoveredAt: new Date(),
        reportedByUserId: ownerUser.id,
      },
    });
    const { resolveIncidentAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      resolveIncidentAction({
        incidentId: incident.id,
        resolution: "Pretending this is fine",
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("recordIncidentNotificationAction rejects STAFF callers", async () => {
    const { practice, ownerUser } = await seed("STAFF");
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Test incident",
        description: "Test description",
        type: "PRIVACY",
        severity: "HIGH",
        phiInvolved: true,
        discoveredAt: new Date(),
        reportedByUserId: ownerUser.id,
      },
    });
    const { recordIncidentNotificationAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      recordIncidentNotificationAction({
        incidentId: incident.id,
        kind: "HHS",
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  // ────────────────────────────────────────────────────────────────────
  // HIPAA C-2: policy actions (ADMIN required, except acknowledge)
  // ────────────────────────────────────────────────────────────────────

  it("adoptPolicyAction rejects STAFF callers", async () => {
    await seed("STAFF");
    const { adoptPolicyAction } = await import(
      "@/app/(dashboard)/programs/policies/actions"
    );
    await expect(
      adoptPolicyAction({ policyCode: "HIPAA_PRIVACY_POLICY" }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("retirePolicyAction rejects STAFF callers", async () => {
    const { practice } = await seed("STAFF");
    // Seed an adopted policy to retire.
    const pp = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        version: 1,
      },
    });
    const { retirePolicyAction } = await import(
      "@/app/(dashboard)/programs/policies/actions"
    );
    await expect(
      retirePolicyAction({ practicePolicyId: pp.id }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("updatePolicyContentAction rejects STAFF callers", async () => {
    const { practice } = await seed("STAFF");
    const pp = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        version: 1,
      },
    });
    const { updatePolicyContentAction } = await import(
      "@/app/(dashboard)/programs/policies/actions"
    );
    await expect(
      updatePolicyContentAction({
        practicePolicyId: pp.id,
        content: "STAFF-edited policy content trying to wipe ack coverage.",
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  // ────────────────────────────────────────────────────────────────────
  // OSHA C-2: PDF route role gates
  // ────────────────────────────────────────────────────────────────────

  it("GET /api/audit/osha-300 rejects STAFF callers (returns 403)", async () => {
    await seed("STAFF");
    const { GET } = await import("@/app/api/audit/osha-300/route");
    const req = new Request("http://test.test/api/audit/osha-300");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("GET /api/audit/osha-301/[id] rejects STAFF callers (returns 403)", async () => {
    const { practice, ownerUser } = await seed("STAFF");
    // Seed an OSHA incident so the route would otherwise succeed.
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Lacerated finger on broken glass",
        description: "Test",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        phiInvolved: false,
        discoveredAt: new Date(),
        oshaBodyPart: "Right hand",
        oshaInjuryNature: "Laceration",
        oshaOutcome: "OTHER_RECORDABLE",
        reportedByUserId: ownerUser.id,
      },
    });
    const { GET } = await import("@/app/api/audit/osha-301/[id]/route");
    const req = new Request(`http://test.test/api/audit/osha-301/${incident.id}`);
    const res = await GET(req, { params: Promise.resolve({ id: incident.id }) });
    expect(res.status).toBe(403);
  });

  // ────────────────────────────────────────────────────────────────────
  // Audit batch-2 (2026-04-30): closes seven sites missed by PR #201.
  //   Credentials CR-2 — credentials-register PDF (sibling of CSV)
  //   Credentials CR-3 — license-number redaction in activity log
  //   HIPAA C-2       — completeSraAction + saveSraDraftAction
  //   HIPAA C-3 (a)   — incident-breach-memo PDF
  //   HIPAA C-3 (b)   — incident-summary PDF
  //   OSHA I-10       — phishing/MFA/backup cybersecurity actions
  //   HIPAA I-8       — training-summary PDF
  // ────────────────────────────────────────────────────────────────────

  // Credentials CR-2: GET /api/audit/credentials-register
  it("GET /api/audit/credentials-register rejects STAFF callers (returns 403)", async () => {
    await seed("STAFF");
    const { GET } = await import("@/app/api/audit/credentials-register/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("GET /api/audit/credentials-register allows ADMIN callers (returns 200 + PDF)", async () => {
    await seed("ADMIN");
    const { GET } = await import("@/app/api/audit/credentials-register/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  // Credentials CR-3: license-number redaction in activity-log formatter
  it("formatEventForActivityLog redacts CREDENTIAL_UPSERTED license number for STAFF/VIEWER", async () => {
    const { formatEventForActivityLog } = await import(
      "@/lib/audit/format-event"
    );
    const evt = {
      type: "CREDENTIAL_UPSERTED",
      payload: {
        credentialTypeCode: "DEA_NUMBER",
        licenseNumber: "BR1234567",
      },
    };
    // STAFF/VIEWER must not see the license number.
    const staffView = formatEventForActivityLog(evt, "STAFF");
    expect(staffView.summary).toBe("DEA_NUMBER");
    expect(staffView.detail).not.toContain("BR1234567");
    const viewerView = formatEventForActivityLog(evt, "VIEWER");
    expect(viewerView.detail).not.toContain("BR1234567");
    // OWNER/ADMIN see the full detail with the #-prefixed number.
    const ownerView = formatEventForActivityLog(evt, "OWNER");
    expect(ownerView.detail).toContain("BR1234567");
    const adminView = formatEventForActivityLog(evt, "ADMIN");
    expect(adminView.detail).toContain("BR1234567");
    // Default (no role passed) is treated as STAFF for safety.
    const defaultView = formatEventForActivityLog(evt);
    expect(defaultView.detail).not.toContain("BR1234567");
  });

  // HIPAA C-2: completeSraAction
  it("completeSraAction rejects STAFF callers", async () => {
    await seed("STAFF");
    // Seed at least one SRA question so validateQuestionCodes() doesn't
    // pre-empt the role gate. Even though requireRole runs first, the
    // test should fail the gate cleanly without any other branch firing.
    await db.sraQuestion.upsert({
      where: { code: "RG_SRA_Q1" },
      update: {},
      create: {
        code: "RG_SRA_Q1",
        category: "ADMINISTRATIVE",
        subcategory: "Security Management Process",
        title: "RG Question 1",
        description: "Test question for role-gate sweep.",
        lookFor: [],
      },
    });
    const { completeSraAction } = await import(
      "@/app/(dashboard)/programs/risk/actions"
    );
    await expect(
      completeSraAction({
        answers: [{ questionCode: "RG_SRA_Q1", answer: "YES", notes: null }],
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("saveSraDraftAction rejects STAFF callers", async () => {
    await seed("STAFF");
    await db.sraQuestion.upsert({
      where: { code: "RG_SRA_Q2" },
      update: {},
      create: {
        code: "RG_SRA_Q2",
        category: "ADMINISTRATIVE",
        subcategory: "Security Management Process",
        title: "RG Question 2",
        description: "Test question for role-gate sweep draft.",
        lookFor: [],
      },
    });
    const { saveSraDraftAction } = await import(
      "@/app/(dashboard)/programs/risk/actions"
    );
    await expect(
      saveSraDraftAction({
        currentStep: 0,
        answers: [{ questionCode: "RG_SRA_Q2", answer: "NO", notes: null }],
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  // HIPAA C-3 (a): GET /api/audit/incident-breach-memo/[id]
  it("GET /api/audit/incident-breach-memo/[id] rejects STAFF callers (returns 403)", async () => {
    const { practice, ownerUser } = await seed("STAFF");
    // Seed a determined incident so the route would otherwise succeed.
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Mailing-room mis-routing",
        description: "Wrong-address statements",
        type: "PRIVACY",
        severity: "HIGH",
        phiInvolved: true,
        discoveredAt: new Date(),
        reportedByUserId: ownerUser.id,
        factor1Score: 4,
        factor2Score: 3,
        factor3Score: 4,
        factor4Score: 2,
        overallRiskScore: 65,
        isBreach: true,
        ocrNotifyRequired: true,
        breachDeterminedAt: new Date(),
        breachDeterminationMemo: "Memo text.",
      },
    });
    const { GET } = await import(
      "@/app/api/audit/incident-breach-memo/[id]/route"
    );
    const res = await GET(new Request("http://test.test"), {
      params: Promise.resolve({ id: incident.id }),
    });
    expect(res.status).toBe(403);
  });

  // HIPAA C-3 (b): GET /api/audit/incident-summary
  it("GET /api/audit/incident-summary rejects STAFF callers (returns 403)", async () => {
    await seed("STAFF");
    const { GET } = await import("@/app/api/audit/incident-summary/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  // OSHA I-10: phishing / MFA / backup cybersecurity actions
  it("logPhishingDrillAction rejects STAFF callers", async () => {
    await seed("STAFF");
    const { logPhishingDrillAction } = await import(
      "@/app/(dashboard)/programs/cybersecurity/actions"
    );
    await expect(
      logPhishingDrillAction({
        conductedAtIso: new Date().toISOString(),
        totalRecipients: 10,
        clickedCount: 1,
        reportedCount: 5,
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("recordMfaEnrollmentAction rejects STAFF callers", async () => {
    const { practice } = await seed("STAFF");
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `mfa-${Math.random().toString(36).slice(2, 10)}`,
        email: `mfa-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const target = await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: practice.id, role: "STAFF" },
    });
    const { recordMfaEnrollmentAction } = await import(
      "@/app/(dashboard)/programs/cybersecurity/actions"
    );
    await expect(
      recordMfaEnrollmentAction({
        practiceUserId: target.id,
        enrolled: true,
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("logBackupVerificationAction rejects STAFF callers", async () => {
    await seed("STAFF");
    const { logBackupVerificationAction } = await import(
      "@/app/(dashboard)/programs/cybersecurity/actions"
    );
    await expect(
      logBackupVerificationAction({
        verifiedAtIso: new Date().toISOString(),
        scope: "Patient charts",
        success: true,
      }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  // HIPAA I-8: GET /api/audit/training-summary
  it("GET /api/audit/training-summary rejects STAFF callers (returns 403)", async () => {
    await seed("STAFF");
    const { GET } = await import("@/app/api/audit/training-summary/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
