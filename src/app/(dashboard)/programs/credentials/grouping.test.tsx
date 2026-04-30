// src/app/(dashboard)/programs/credentials/grouping.test.ts
//
// Audit #21 / Credentials CR-4 — unit coverage on the pure grouping
// helper that drives `/programs/credentials`. Pre-fix, the page filtered
// out PracticeUsers whose removedAt was set, so credentials assigned to
// off-boarded staff silently disappeared from the UI even though they
// stayed on the books. The integration test
// (`tests/integration/credentials-removed-staff-orphan.test.ts`) covers
// the same regression end-to-end with a real DB; this file isolates the
// ordering / labelling rules.

import { describe, it, expect } from "vitest";
import {
  buildCredentialGroups,
  type CredentialGroupInput,
  type HolderForGrouping,
} from "./grouping";

const cred = (id: string, holderId: string | null): CredentialGroupInput => ({
  id,
  holderId,
});

const holder = (
  id: string,
  displayName: string,
  removedAt: Date | null = null,
): HolderForGrouping => ({ id, displayName, removedAt });

describe("buildCredentialGroups", () => {
  it("renders an empty list when there are no credentials", () => {
    const groups = buildCredentialGroups(
      [holder("h1", "Alice"), holder("h2", "Bob")],
      [],
    );
    expect(groups).toEqual([]);
  });

  it("groups active staff in input order, with practice-level last", () => {
    const groups = buildCredentialGroups(
      [holder("h1", "Alice"), holder("h2", "Bob")],
      [
        cred("c1", "h1"),
        cred("c2", "h2"),
        cred("c3", null),
        cred("c4", "h1"),
      ],
    );
    expect(groups.map((g) => g.heading)).toEqual([
      "Alice",
      "Bob",
      "Practice-level",
    ]);
    expect(groups[0]!.credentials.map((c) => c.id)).toEqual(["c1", "c4"]);
    expect(groups[1]!.credentials.map((c) => c.id)).toEqual(["c2"]);
    expect(groups[2]!.credentials.map((c) => c.id)).toEqual(["c3"]);
  });

  it("renders a 'Former staff' group for removed PracticeUsers (CR-4)", () => {
    const groups = buildCredentialGroups(
      [
        holder("h1", "Alice"),
        holder("h2", "Bob", new Date("2026-04-01T00:00:00Z")),
      ],
      [cred("c1", "h1"), cred("c2", "h2")],
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      heading: "Alice",
      isFormerStaff: false,
      isPracticeLevel: false,
    });
    expect(groups[1]).toMatchObject({
      heading: "Former staff: Bob",
      isFormerStaff: true,
      isPracticeLevel: false,
    });
  });

  it("orders active before former staff before practice-level", () => {
    const groups = buildCredentialGroups(
      [
        holder("h1", "Alice"),
        holder("h2", "Bob", new Date("2026-04-01T00:00:00Z")),
        holder("h3", "Carol"),
      ],
      [
        cred("c1", "h1"),
        cred("c2", "h2"),
        cred("c3", "h3"),
        cred("c4", null),
      ],
    );
    expect(groups.map((g) => g.heading)).toEqual([
      "Alice",
      "Carol",
      "Former staff: Bob",
      "Practice-level",
    ]);
    expect(groups.map((g) => g.isFormerStaff)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(groups.map((g) => g.isPracticeLevel)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("sorts multiple former-staff holders alphabetically by displayName", () => {
    const groups = buildCredentialGroups(
      [
        holder("h-z", "Zoe", new Date("2026-04-01T00:00:00Z")),
        holder("h-a", "Aaron", new Date("2026-04-01T00:00:00Z")),
        holder("h-m", "Mara", new Date("2026-04-01T00:00:00Z")),
      ],
      [cred("c1", "h-z"), cred("c2", "h-a"), cred("c3", "h-m")],
    );
    expect(groups.map((g) => g.heading)).toEqual([
      "Former staff: Aaron",
      "Former staff: Mara",
      "Former staff: Zoe",
    ]);
  });

  it("skips holder groups with no credentials (active or former)", () => {
    const groups = buildCredentialGroups(
      [
        holder("h1", "Alice"),
        holder("h2", "Bob"),
        holder("h3", "Carol", new Date("2026-04-01T00:00:00Z")),
      ],
      [cred("c1", "h2")],
    );
    expect(groups.map((g) => g.heading)).toEqual(["Bob"]);
  });

  it("uses a stable React key per group (holder id, or 'practice-level')", () => {
    const groups = buildCredentialGroups(
      [
        holder("h1", "Alice"),
        holder("h2", "Bob", new Date("2026-04-01T00:00:00Z")),
      ],
      [cred("c1", "h1"), cred("c2", "h2"), cred("c3", null)],
    );
    expect(groups.map((g) => g.key)).toEqual(["h1", "h2", "practice-level"]);
  });
});
