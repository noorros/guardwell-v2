// tests/integration/training-certificate.test.ts
//
// Phase 4 PR 7 — Integration tests for GET /api/training/certificate/[id].
// Pattern mirrors tests/integration/dea-form-41-pdf.test.ts: real DB,
// mocked auth, call the route's GET handler directly, assert the
// 200/PDF happy path AND the cross-tenant 404 / role-gate 403 / failed
// attempt 400 / unauthenticated 401 paths.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__certTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__certTestUser) throw new Error("Unauthorized");
      return globalThis.__certTestUser;
    },
  };
});

declare global {
  var __certTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

beforeEach(() => {
  globalThis.__certTestUser = null;
});

async function seedPracticeWithUser(
  name: string,
  role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER" = "STAFF",
  primaryState = "AZ",
) {
  const user = await db.user.create({
    data: {
      firebaseUid: `cert-${Math.random().toString(36).slice(2, 10)}`,
      email: `cert-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Pat",
      lastName: "Smith",
    },
  });
  const practice = await db.practice.create({
    data: { name, primaryState, timezone: "America/Phoenix" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role },
  });
  return { user, practice };
}

async function seedAdditionalUser(
  practiceId: string,
  role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER" = "STAFF",
) {
  const user = await db.user.create({
    data: {
      firebaseUid: `cert-add-${Math.random().toString(36).slice(2, 10)}`,
      email: `cert-add-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Alex",
      lastName: "Doe",
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId, role },
  });
  return user;
}

async function seedCompletion(opts: {
  practiceId: string;
  userId: string;
  passed?: boolean;
  score?: number;
}) {
  const code = `CERT_TEST_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const course = await db.trainingCourse.upsert({
    where: { code },
    update: {},
    create: {
      code,
      title: `Certificate Test Course ${code}`,
      type: "HIPAA",
      lessonContent: "lesson body",
      durationMinutes: 30,
      passingScore: 80,
      version: 2,
    },
  });
  const completion = await db.trainingCompletion.create({
    data: {
      practiceId: opts.practiceId,
      userId: opts.userId,
      courseId: course.id,
      courseVersion: course.version,
      score: opts.score ?? 95,
      passed: opts.passed ?? true,
      completedAt: new Date("2026-04-30T17:00:00Z"),
      expiresAt: new Date("2027-04-30T17:00:00Z"),
    },
  });
  return { course, completion };
}

function signInAs(user: { id: string; email: string; firebaseUid: string }) {
  globalThis.__certTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
}

describe("GET /api/training/certificate/[completionId]", () => {
  it("returns 200 + PDF for a STAFF user's own passed completion", async () => {
    const { user, practice } = await seedPracticeWithUser(
      "Cert STAFF Practice",
      "STAFF",
    );
    signInAs(user);
    const { completion } = await seedCompletion({
      practiceId: practice.id,
      userId: user.id,
    });

    const { GET } = await import(
      "@/app/api/training/certificate/[completionId]/route"
    );
    const res = await GET(
      new Request(`http://localhost/api/training/certificate/${completion.id}`),
      { params: Promise.resolve({ completionId: completion.id }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(
      new RegExp(`certificate-${completion.id}\\.pdf`),
    );

    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(0);
    // PDF magic bytes
    const head = Buffer.from(buf.slice(0, 5)).toString("latin1");
    expect(head).toBe("%PDF-");
  });

  it("returns 200 for an OWNER downloading a peer's certificate (same practice)", async () => {
    const { user: owner, practice } = await seedPracticeWithUser(
      "Cert OWNER Practice",
      "OWNER",
    );
    const peer = await seedAdditionalUser(practice.id, "STAFF");
    signInAs(owner);
    const { completion } = await seedCompletion({
      practiceId: practice.id,
      userId: peer.id,
    });

    const { GET } = await import(
      "@/app/api/training/certificate/[completionId]/route"
    );
    const res = await GET(
      new Request(`http://localhost/api/training/certificate/${completion.id}`),
      { params: Promise.resolve({ completionId: completion.id }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("returns 200 for an ADMIN downloading a peer's certificate (same practice)", async () => {
    const { user: admin, practice } = await seedPracticeWithUser(
      "Cert ADMIN Practice",
      "ADMIN",
    );
    const peer = await seedAdditionalUser(practice.id, "STAFF");
    signInAs(admin);
    const { completion } = await seedCompletion({
      practiceId: practice.id,
      userId: peer.id,
    });

    const { GET } = await import(
      "@/app/api/training/certificate/[completionId]/route"
    );
    const res = await GET(
      new Request(`http://localhost/api/training/certificate/${completion.id}`),
      { params: Promise.resolve({ completionId: completion.id }) },
    );

    expect(res.status).toBe(200);
  });

  it("returns 403 for STAFF trying to download a peer's certificate (same practice)", async () => {
    const { user: staff, practice } = await seedPracticeWithUser(
      "Cert STAFF-peer Practice",
      "STAFF",
    );
    const peer = await seedAdditionalUser(practice.id, "STAFF");
    signInAs(staff);
    const { completion } = await seedCompletion({
      practiceId: practice.id,
      userId: peer.id,
    });

    const { GET } = await import(
      "@/app/api/training/certificate/[completionId]/route"
    );
    const res = await GET(
      new Request(`http://localhost/api/training/certificate/${completion.id}`),
      { params: Promise.resolve({ completionId: completion.id }) },
    );

    expect(res.status).toBe(403);
  });

  it("returns 403 for VIEWER trying to download a peer's certificate (same practice)", async () => {
    const { user: viewer, practice } = await seedPracticeWithUser(
      "Cert VIEWER Practice",
      "VIEWER",
    );
    const peer = await seedAdditionalUser(practice.id, "STAFF");
    signInAs(viewer);
    const { completion } = await seedCompletion({
      practiceId: practice.id,
      userId: peer.id,
    });

    const { GET } = await import(
      "@/app/api/training/certificate/[completionId]/route"
    );
    const res = await GET(
      new Request(`http://localhost/api/training/certificate/${completion.id}`),
      { params: Promise.resolve({ completionId: completion.id }) },
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 when the completion belongs to a different practice (cross-tenant guard)", async () => {
    const { user: u1 } = await seedPracticeWithUser("Cert Practice One");
    const { user: u2, practice: p2 } = await seedPracticeWithUser(
      "Cert Practice Two",
    );
    signInAs(u1);
    const { completion } = await seedCompletion({
      practiceId: p2.id,
      userId: u2.id,
    });

    const { GET } = await import(
      "@/app/api/training/certificate/[completionId]/route"
    );
    const res = await GET(
      new Request(`http://localhost/api/training/certificate/${completion.id}`),
      { params: Promise.resolve({ completionId: completion.id }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 when the completion is for a failed attempt", async () => {
    const { user, practice } = await seedPracticeWithUser(
      "Cert Failed Practice",
      "STAFF",
    );
    signInAs(user);
    const { completion } = await seedCompletion({
      practiceId: practice.id,
      userId: user.id,
      passed: false,
      score: 50,
    });

    const { GET } = await import(
      "@/app/api/training/certificate/[completionId]/route"
    );
    const res = await GET(
      new Request(`http://localhost/api/training/certificate/${completion.id}`),
      { params: Promise.resolve({ completionId: completion.id }) },
    );

    expect(res.status).toBe(400);
  });

  it("returns 401 when no user is signed in", async () => {
    // signInAs intentionally NOT called.
    const { user, practice } = await seedPracticeWithUser(
      "Cert No-Sign-In Practice",
      "STAFF",
    );
    const { completion } = await seedCompletion({
      practiceId: practice.id,
      userId: user.id,
    });

    const { GET } = await import(
      "@/app/api/training/certificate/[completionId]/route"
    );
    const res = await GET(
      new Request(`http://localhost/api/training/certificate/${completion.id}`),
      { params: Promise.resolve({ completionId: completion.id }) },
    );

    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent completion id", async () => {
    const { user } = await seedPracticeWithUser(
      "Cert Missing Practice",
      "STAFF",
    );
    signInAs(user);

    const { GET } = await import(
      "@/app/api/training/certificate/[completionId]/route"
    );
    const res = await GET(
      new Request("http://localhost/api/training/certificate/does-not-exist"),
      { params: Promise.resolve({ completionId: "does-not-exist" }) },
    );

    expect(res.status).toBe(404);
  });
});
