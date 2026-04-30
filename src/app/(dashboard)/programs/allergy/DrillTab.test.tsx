// @vitest-environment jsdom
//
// Audit #21 (Allergy IM-2) — render-side label test.
//
// Legacy drills may carry participantIds that no longer resolve to an
// active member of the practice (member removed, or — for the very
// oldest pre-FK-guard rows — an id that belongs to another practice
// entirely). The DrillTab must surface "User no longer at practice"
// rather than "Unknown" so reviewers know the row points to a real but
// no-longer-current person.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
import { DrillTab } from "./DrillTab";

const baseMembers = [
  { id: "active-1", role: "OWNER", requiresAllergyCompetency: false, name: "Alice Active", email: "alice@test.test" },
  { id: "active-2", role: "STAFF", requiresAllergyCompetency: true, name: "Bob Active", email: "bob@test.test" },
];

describe("<DrillTab> participant labels (audit #21 IM-2)", () => {
  it("renders 'no longer at practice' for a participantId pointing to a removed member", () => {
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <DrillTab
          canManage={false}
          members={baseMembers}
          drills={[
            {
              id: "drill-1",
              conductedAt: "2026-03-15T15:00:00Z",
              scenario: "Anaphylaxis test scenario",
              participantIds: ["active-1", "removed-1"],
              durationMinutes: 20,
              observations: null,
              correctiveActions: null,
              nextDrillDue: null,
            },
          ]}
          legacyParticipants={[
            { id: "removed-1", name: "Carol Removed", sameTenant: true },
          ]}
        />
      </PracticeTimezoneProvider>,
    );
    // Expand the drill row.
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    // Active member name still appears verbatim, removed member gets the
    // "no longer at practice" suffix.
    expect(screen.getByText(/Alice Active/)).toBeInTheDocument();
    expect(
      screen.getByText(/Carol Removed.*no longer at practice/i),
    ).toBeInTheDocument();
  });

  it("falls back to a generic 'User no longer at practice' label when no legacyParticipants entry exists", () => {
    // E.g. the page-level query missed the row (deleted user record) — the
    // UI must NOT crash and must NOT render "Unknown" without context.
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <DrillTab
          canManage={false}
          members={baseMembers}
          drills={[
            {
              id: "drill-2",
              conductedAt: "2026-03-15T15:00:00Z",
              scenario: "Drill with completely orphaned id",
              participantIds: ["active-1", "ghost-id"],
              durationMinutes: 20,
              observations: null,
              correctiveActions: null,
              nextDrillDue: null,
            },
          ]}
          legacyParticipants={[]}
        />
      </PracticeTimezoneProvider>,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(
      screen.getByText(/User no longer at practice/i),
    ).toBeInTheDocument();
  });

  it("does not break when legacyParticipants prop is omitted (back-compat default)", () => {
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <DrillTab
          canManage={false}
          members={baseMembers}
          drills={[
            {
              id: "drill-3",
              conductedAt: "2026-03-15T15:00:00Z",
              scenario: "Drill with all active participants",
              participantIds: ["active-1", "active-2"],
              durationMinutes: 20,
              observations: null,
              correctiveActions: null,
              nextDrillDue: null,
            },
          ]}
        />
      </PracticeTimezoneProvider>,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/Alice Active.*Bob Active/)).toBeInTheDocument();
    expect(
      screen.queryByText(/no longer at practice/i),
    ).not.toBeInTheDocument();
  });
});
