// tests/integration/incident-breach-memo-pdf.test.ts
//
// Integration tests for GET /api/audit/incident-breach-memo/[id] —
// HIPAA §164.402 breach memo PDF generator. Covers happy path, the
// pre-determination 404, and the cross-tenant 404 guard.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { inflateSync } from "node:zlib";
import { db } from "@/lib/db";

// React-PDF emits content streams gzipped via /Filter /FlateDecode and
// then encodes literal text as PDF hex strings inside Tj/TJ operators
// (e.g. `[<484950> 100 <4141>] TJ` for "HIPAA"). To verify body text
// rendered (the metadata Title/Subject strings are stored separately
// as UTF-16BE), we (1) extract + inflate every FlateDecode stream, then
// (2) decode every `<…>` hex literal back to ASCII and concatenate.
function extractInflatedText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString("latin1");
  const decoded: string[] = [];
  // Find every "stream\n…endstream" block and try to inflate it. Some
  // streams may not actually be deflated (e.g. /Length 0); inflate
  // failures are silently skipped.
  const streamRe =
    /<<[^>]*\/Filter \/FlateDecode[^>]*>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null) {
    const streamBody = m[1];
    if (!streamBody) continue;
    let inflated: string;
    try {
      inflated = inflateSync(Buffer.from(streamBody, "latin1")).toString(
        "latin1",
      );
    } catch {
      continue;
    }
    // Pull out every `<HEXHEXHEX>` hex literal and decode to ASCII.
    const hexRe = /<([0-9a-fA-F]+)>/g;
    let h: RegExpExecArray | null;
    while ((h = hexRe.exec(inflated)) !== null) {
      const hex = h[1];
      if (!hex) continue;
      // Skip non-byte-aligned matches and BOMs (UTF-16 metadata also
      // appears as hex literals elsewhere; for body text in content
      // streams these are always paired-hex bytes).
      if (hex.length % 2 !== 0) continue;
      let s = "";
      for (let i = 0; i < hex.length; i += 2) {
        s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      decoded.push(s);
    }
  }
  return decoded.join("");
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__testUser ?? null,
    requireUser: async () => {
      if (!globalThis.__testUser) throw new Error("Unauthorized");
      return globalThis.__testUser;
    },
  };
});

declare global {
  var __testUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

beforeEach(() => {
  globalThis.__testUser = null;
});

async function seedPracticeWithUser(name: string, primaryState = "AZ") {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `bm-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name, primaryState },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

function signInAs(user: { id: string; email: string; firebaseUid: string }) {
  globalThis.__testUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
}

describe("GET /api/audit/incident-breach-memo/[id]", () => {
  it("returns 200 + PDF when breach determination + memo are recorded", async () => {
    const { user, practice } = await seedPracticeWithUser(
      "Breach Memo Test Clinic",
      "CA",
    );
    signInAs(user);

    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Mailing room mis-routing — 12 patients",
        type: "PRIVACY",
        severity: "HIGH",
        status: "UNDER_INVESTIGATION",
        description: "12 statements mailed to wrong addresses.",
        phiInvolved: true,
        patientState: "CA",
        affectedCount: 12,
        discoveredAt: new Date("2026-04-20T10:00:00Z"),
        reportedByUserId: user.id,
        factor1Score: 4,
        factor2Score: 3,
        factor3Score: 4,
        factor4Score: 2,
        overallRiskScore: 65,
        isBreach: true,
        ocrNotifyRequired: true,
        breachDeterminedAt: new Date("2026-04-21T15:00:00Z"),
        breachDeterminationMemo:
          "Statements containing patient name, DOB, and service code mailed to wrong addresses. Recipients are unrelated third parties; no signed assurance of destruction received yet. Risk classified as moderate-to-high probability of compromise.",
      },
    });

    const { GET } = await import(
      "@/app/api/audit/incident-breach-memo/[id]/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: incident.id }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");

    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(2000);

    // Inflate the FlateDecode content streams so we can grep the
    // rendered Helvetica text show operators for our expected strings.
    const text = extractInflatedText(buf);
    expect(text).toMatch(/HIPAA/);
    expect(text).toMatch(/Breach Determination Memo/i);
    expect(text).toMatch(/Factor 1/);
  });

  it("returns 404 when breach determination has not been recorded yet", async () => {
    const { user, practice } = await seedPracticeWithUser(
      "Open Incident Clinic",
    );
    signInAs(user);

    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Open incident pending review",
        type: "PRIVACY",
        severity: "MEDIUM",
        status: "OPEN",
        description: "Awaiting determination.",
        phiInvolved: true,
        affectedCount: 5,
        discoveredAt: new Date("2026-04-25T10:00:00Z"),
        reportedByUserId: user.id,
      },
    });

    const { GET } = await import(
      "@/app/api/audit/incident-breach-memo/[id]/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: incident.id }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not been recorded/i);
  });

  it("returns 404 when the incident belongs to a different practice", async () => {
    const { user: u1 } = await seedPracticeWithUser("Practice One");
    const { user: u2, practice: p2 } = await seedPracticeWithUser(
      "Practice Two",
    );
    signInAs(u1); // signed in to practice 1

    // Incident lives in practice 2.
    const otherIncident = await db.incident.create({
      data: {
        practiceId: p2.id,
        title: "Cross-tenant test",
        type: "PRIVACY",
        severity: "LOW",
        status: "RESOLVED",
        description: "Some other practice's incident.",
        phiInvolved: false,
        affectedCount: 0,
        discoveredAt: new Date("2026-04-22T10:00:00Z"),
        reportedByUserId: u2.id,
        factor1Score: 1,
        factor2Score: 1,
        factor3Score: 1,
        factor4Score: 1,
        overallRiskScore: 20,
        isBreach: false,
        ocrNotifyRequired: false,
        breachDeterminedAt: new Date("2026-04-22T11:00:00Z"),
        breachDeterminationMemo:
          "Test memo for cross-tenant guard. Should be inaccessible to practice 1's user.",
      },
    });

    const { GET } = await import(
      "@/app/api/audit/incident-breach-memo/[id]/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: otherIncident.id }),
    });

    expect(res.status).toBe(404);
  });
});
