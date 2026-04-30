// @vitest-environment jsdom
//
// Audit #21 (CHROME-2): the EditDrillForm `<input type="date">` value
// must reflect the practice's calendar day, not the UTC slice. A drill
// conducted at 2026-04-30 21:00 PST (= 2026-05-01 04:00 UTC) should
// render in California's edit form as "2026-04-30", not "2026-05-01".

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
import { DrillTab } from "./DrillTab";

const baseDrill = {
  id: "drill-1",
  // 2026-05-01T04:00:00Z = 2026-04-30 21:00 PDT (UTC-7).
  conductedAt: "2026-05-01T04:00:00Z",
  scenario: "Standard anaphylaxis drill",
  participantIds: [],
  durationMinutes: 30,
  observations: null,
  correctiveActions: null,
  // 2026-12-31T08:00:00Z = 2026-12-31 00:00 PST (boundary).
  nextDrillDue: "2026-12-31T08:00:00Z",
};

function openEditForm() {
  // Expand the drill row + open edit mode.
  fireEvent.click(
    screen.getByRole("button", { name: /standard anaphylaxis drill/i }),
  );
  fireEvent.click(screen.getByRole("button", { name: /edit/i }));
}

function getEditDateInput(name: "date" | "next-due"): HTMLInputElement {
  // EditDrillForm wires inputs with id `edit-drill-${drill.id}-{date,next-due}`
  // (see DrillTab editPrefix). Query by id to disambiguate from the
  // sibling LogDrillForm which uses bare `drill-date` ids.
  const id = `edit-drill-${baseDrill.id}-${name}`;
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) {
    throw new Error(`Could not find edit input #${id}`);
  }
  return el;
}

describe("DrillTab — TZ-aware date input value", () => {
  it("EditDrillForm seeds inputs with practice-tz YYYY-MM-DD (Pacific)", () => {
    render(
      <PracticeTimezoneProvider value="America/Los_Angeles">
        <DrillTab canManage={true} members={[]} drills={[baseDrill]} />
      </PracticeTimezoneProvider>,
    );
    openEditForm();
    // The conducted-at input value must match the Pacific calendar day,
    // not the UTC slice (which would render 2026-05-01).
    expect(getEditDateInput("date").value).toBe("2026-04-30");
    // The next-due is set at 08:00 UTC on Dec 31 — still Dec 31 PST.
    expect(getEditDateInput("next-due").value).toBe("2026-12-31");
  });

  it("EditDrillForm seeds inputs with the Eastern calendar day", () => {
    render(
      <PracticeTimezoneProvider value="America/New_York">
        <DrillTab canManage={true} members={[]} drills={[baseDrill]} />
      </PracticeTimezoneProvider>,
    );
    openEditForm();
    // 2026-05-01T04:00:00Z = 2026-05-01 00:00 EDT (UTC-4) — locally May 1.
    expect(getEditDateInput("date").value).toBe("2026-05-01");
  });

  it("falls back to UTC when no PracticeTimezoneProvider is mounted", () => {
    render(<DrillTab canManage={true} members={[]} drills={[baseDrill]} />);
    openEditForm();
    // UTC view of 2026-05-01T04:00:00Z is plainly 2026-05-01.
    expect(getEditDateInput("date").value).toBe("2026-05-01");
  });
});
