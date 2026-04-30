// src/lib/training/resolveGrid.test.ts
//
// Phase 4 PR 5 — pure-function tests for the assignment grid resolver.
// No DB; we hand-craft fixtures and pin every status branch:
//   - COMPLETED takes priority over OVERDUE
//   - Direct user / role-wide / category-wide assignment matching
//   - AssignmentExclusion suppresses a role-wide assignment for one user
//   - Expired completion + active assignment → TO_DO ("Expired · retake")
//   - dueDate in past + no completion → OVERDUE
//   - assignment + no completion + no due-date → IN_PROGRESS placeholder
//   - no assignment of any kind → NOT_ASSIGNED

import { describe, it, expect } from "vitest";
import { resolveGridCells } from "./resolveGrid";

const NOW = new Date("2026-04-30T12:00:00Z");
const PAST = new Date("2026-04-01T00:00:00Z"); // before NOW
const FUTURE = new Date("2026-12-31T00:00:00Z"); // after NOW
const FAR_PAST = new Date("2025-04-01T00:00:00Z"); // long before NOW

describe("resolveGridCells", () => {
  it("returns NOT_ASSIGNED when no assignment matches a (staff, course) pair", () => {
    const cells = resolveGridCells({
      staff: [{ userId: "u-1", role: "STAFF" }],
      courses: [{ id: "c-1" }],
      assignments: [],
      exclusions: [],
      completions: [],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("NOT_ASSIGNED");
    expect(cells["u-1"]?.["c-1"]?.completedAtIso).toBeNull();
    expect(cells["u-1"]?.["c-1"]?.dueDateIso).toBeNull();
  });

  it("resolves a direct user assignment for that user only", () => {
    const cells = resolveGridCells({
      staff: [
        { userId: "u-1", role: "STAFF" },
        { userId: "u-2", role: "STAFF" },
      ],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: "u-1",
          assignedToRole: null,
          assignedToCategory: null,
          dueDate: null,
        },
      ],
      exclusions: [],
      completions: [],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("IN_PROGRESS");
    expect(cells["u-2"]?.["c-1"]?.status).toBe("NOT_ASSIGNED");
  });

  it("resolves a role-wide assignment for staff with matching role", () => {
    const cells = resolveGridCells({
      staff: [
        { userId: "u-staff", role: "STAFF" },
        { userId: "u-admin", role: "ADMIN" },
      ],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: null,
          assignedToRole: "STAFF",
          assignedToCategory: null,
          dueDate: null,
        },
      ],
      exclusions: [],
      completions: [],
      now: NOW,
    });
    expect(cells["u-staff"]?.["c-1"]?.status).toBe("IN_PROGRESS");
    expect(cells["u-admin"]?.["c-1"]?.status).toBe("NOT_ASSIGNED");
  });

  it("resolves a category-wide assignment for staff with matching category", () => {
    const cells = resolveGridCells({
      staff: [
        { userId: "u-clin", role: "STAFF", category: "CLINICAL" },
        { userId: "u-adm", role: "STAFF", category: "ADMINISTRATIVE" },
        { userId: "u-none", role: "STAFF" }, // no category
      ],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: null,
          assignedToRole: null,
          assignedToCategory: "CLINICAL",
          dueDate: null,
        },
      ],
      exclusions: [],
      completions: [],
      now: NOW,
    });
    expect(cells["u-clin"]?.["c-1"]?.status).toBe("IN_PROGRESS");
    expect(cells["u-adm"]?.["c-1"]?.status).toBe("NOT_ASSIGNED");
    expect(cells["u-none"]?.["c-1"]?.status).toBe("NOT_ASSIGNED");
  });

  it("excluded user shows NOT_ASSIGNED even if a role-wide assignment matches", () => {
    const cells = resolveGridCells({
      staff: [
        { userId: "u-1", role: "STAFF" },
        { userId: "u-2", role: "STAFF" },
      ],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: null,
          assignedToRole: "STAFF",
          assignedToCategory: null,
          dueDate: null,
        },
      ],
      exclusions: [{ assignmentId: "a-1", userId: "u-1" }],
      completions: [],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("NOT_ASSIGNED");
    expect(cells["u-2"]?.["c-1"]?.status).toBe("IN_PROGRESS");
  });

  it("OVERDUE when assignment dueDate < now and no passing completion", () => {
    const cells = resolveGridCells({
      staff: [{ userId: "u-1", role: "STAFF" }],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: "u-1",
          assignedToRole: null,
          assignedToCategory: null,
          dueDate: PAST,
        },
      ],
      exclusions: [],
      completions: [],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("OVERDUE");
    expect(cells["u-1"]?.["c-1"]?.dueDateIso).toBe(PAST.toISOString());
  });

  it("IN_PROGRESS when assignment exists with future due date and no completion", () => {
    const cells = resolveGridCells({
      staff: [{ userId: "u-1", role: "STAFF" }],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: "u-1",
          assignedToRole: null,
          assignedToCategory: null,
          dueDate: FUTURE,
        },
      ],
      exclusions: [],
      completions: [],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("IN_PROGRESS");
    expect(cells["u-1"]?.["c-1"]?.dueDateIso).toBe(FUTURE.toISOString());
  });

  it("COMPLETED with date when a fresh passing completion exists", () => {
    const completedAt = new Date("2026-04-15T00:00:00Z");
    const cells = resolveGridCells({
      staff: [{ userId: "u-1", role: "STAFF" }],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: "u-1",
          assignedToRole: null,
          assignedToCategory: null,
          dueDate: null,
        },
      ],
      exclusions: [],
      completions: [
        {
          userId: "u-1",
          courseId: "c-1",
          completedAt,
          expiresAt: FUTURE,
        },
      ],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("COMPLETED");
    expect(cells["u-1"]?.["c-1"]?.completedAtIso).toBe(completedAt.toISOString());
  });

  it("COMPLETED takes priority over OVERDUE (fresh completion overrides past due-date)", () => {
    const completedAt = new Date("2026-04-15T00:00:00Z");
    const cells = resolveGridCells({
      staff: [{ userId: "u-1", role: "STAFF" }],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: "u-1",
          assignedToRole: null,
          assignedToCategory: null,
          dueDate: PAST, // past due
        },
      ],
      exclusions: [],
      completions: [
        {
          userId: "u-1",
          courseId: "c-1",
          completedAt,
          expiresAt: FUTURE, // still fresh
        },
      ],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("COMPLETED");
  });

  it("expired passing completion + active assignment → TO_DO (Expired · retake)", () => {
    const cells = resolveGridCells({
      staff: [{ userId: "u-1", role: "STAFF" }],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: "u-1",
          assignedToRole: null,
          assignedToCategory: null,
          dueDate: null,
        },
      ],
      exclusions: [],
      completions: [
        {
          userId: "u-1",
          courseId: "c-1",
          completedAt: FAR_PAST,
          expiresAt: PAST, // already expired
        },
      ],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("TO_DO");
    expect(cells["u-1"]?.["c-1"]?.completedAtIso).toBe(FAR_PAST.toISOString());
  });

  it("uses the most-recent passing completion when multiple exist for the same (user, course)", () => {
    const older = new Date("2025-01-01T00:00:00Z");
    const newer = new Date("2026-04-01T00:00:00Z");
    const cells = resolveGridCells({
      staff: [{ userId: "u-1", role: "STAFF" }],
      courses: [{ id: "c-1" }],
      assignments: [
        {
          id: "a-1",
          courseId: "c-1",
          assignedToUserId: "u-1",
          assignedToRole: null,
          assignedToCategory: null,
          dueDate: null,
        },
      ],
      exclusions: [],
      completions: [
        {
          userId: "u-1",
          courseId: "c-1",
          completedAt: older,
          expiresAt: PAST, // expired
        },
        {
          userId: "u-1",
          courseId: "c-1",
          completedAt: newer,
          expiresAt: FUTURE, // fresh
        },
      ],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("COMPLETED");
    expect(cells["u-1"]?.["c-1"]?.completedAtIso).toBe(newer.toISOString());
  });

  it("builds a Record keyed by staff.userId → courseId → cell for every (staff, course) pair", () => {
    const cells = resolveGridCells({
      staff: [
        { userId: "u-a", role: "STAFF" },
        { userId: "u-b", role: "ADMIN" },
      ],
      courses: [{ id: "c-1" }, { id: "c-2" }, { id: "c-3" }],
      assignments: [],
      exclusions: [],
      completions: [],
      now: NOW,
    });
    expect(Object.keys(cells)).toEqual(["u-a", "u-b"]);
    expect(Object.keys(cells["u-a"]!)).toEqual(["c-1", "c-2", "c-3"]);
    expect(Object.keys(cells["u-b"]!)).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("a fresh completion without an active assignment still reads as COMPLETED", () => {
    // Edge: assignment was revoked after the user finished. They keep credit.
    const completedAt = new Date("2026-04-15T00:00:00Z");
    const cells = resolveGridCells({
      staff: [{ userId: "u-1", role: "STAFF" }],
      courses: [{ id: "c-1" }],
      assignments: [],
      exclusions: [],
      completions: [
        {
          userId: "u-1",
          courseId: "c-1",
          completedAt,
          expiresAt: FUTURE,
        },
      ],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("COMPLETED");
  });

  it("expired completion without an active assignment reads as NOT_ASSIGNED (no obligation today)", () => {
    const cells = resolveGridCells({
      staff: [{ userId: "u-1", role: "STAFF" }],
      courses: [{ id: "c-1" }],
      assignments: [],
      exclusions: [],
      completions: [
        {
          userId: "u-1",
          courseId: "c-1",
          completedAt: FAR_PAST,
          expiresAt: PAST,
        },
      ],
      now: NOW,
    });
    expect(cells["u-1"]?.["c-1"]?.status).toBe("NOT_ASSIGNED");
  });
});
