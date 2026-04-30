// src/app/(dashboard)/programs/allergy/EquipmentTab.test.tsx
//
// Audit #21 Allergy IM-6 (2026-04-30): kit checks now render as a history
// table (one row per AllergyEquipmentCheck) so audit-prep can demonstrate
// ongoing competency. These tests guard:
//   1. Newest-first row order
//   2. Empty state when no kit checks exist
//   3. Soft-deleted rows excluded (page-level retiredAt filter respected
//      — i.e. the component never receives them, so it never shows them)
//   4. Edit/Delete affordances visible to ADMIN, hidden from STAFF/VIEWER
//      (delegated to the shared HistoryRowActions canManage gate)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("./actions", () => ({
  deleteEquipmentCheckAction: vi.fn(),
  logEquipmentCheckAction: vi.fn(),
  updateEquipmentCheckAction: vi.fn(),
}));

import { EquipmentTab, type EquipmentTabProps } from "./EquipmentTab";

type Check = EquipmentTabProps["checks"][number];

function makeKitCheck(overrides: Partial<Check> = {}): Check {
  return {
    id: "kit-1",
    checkType: "EMERGENCY_KIT",
    checkedAt: "2026-04-29T12:00:00.000Z",
    epiExpiryDate: "2027-01-15T00:00:00.000Z",
    epiLotNumber: "AB12345",
    allItemsPresent: true,
    itemsReplaced: null,
    temperatureC: null,
    inRange: null,
    notes: null,
    ...overrides,
  };
}

describe("<EquipmentTab> kit history (audit #21 IM-6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders kit history rows in newest-first order", () => {
    const newest = makeKitCheck({
      id: "kit-newest",
      checkedAt: "2026-04-29T12:00:00.000Z",
      epiLotNumber: "LOT-NEWEST",
    });
    const middle = makeKitCheck({
      id: "kit-middle",
      checkedAt: "2026-03-15T12:00:00.000Z",
      epiLotNumber: "LOT-MIDDLE",
    });
    const oldest = makeKitCheck({
      id: "kit-oldest",
      checkedAt: "2026-01-05T12:00:00.000Z",
      epiLotNumber: "LOT-OLDEST",
    });

    // Pass them in deliberately-shuffled order to confirm the component
    // does its own newest-first sort (defense against a future re-fetch
    // path that forgets to .orderBy at the page).
    const shuffled: Check[] = [oldest, newest, middle];

    const { container } = render(
      <EquipmentTab canManage={true} checks={shuffled} />,
    );

    // Find the kit table by locating its caption-equivalent header section.
    // The kit table is the first <table> in the document since fridge has
    // no rows in this fixture.
    const tables = container.querySelectorAll("table");
    expect(tables.length).toBeGreaterThanOrEqual(1);
    const kitTable = tables[0];
    const lotCells = within(kitTable as HTMLElement).getAllByText(
      /LOT-(NEWEST|MIDDLE|OLDEST)/,
    );
    expect(lotCells.map((c) => c.textContent)).toEqual([
      "LOT-NEWEST",
      "LOT-MIDDLE",
      "LOT-OLDEST",
    ]);
  });

  it("shows the empty placeholder when there are no kit checks", () => {
    render(<EquipmentTab canManage={true} checks={[]} />);
    expect(
      screen.getByText("No emergency kit checks recorded yet."),
    ).toBeInTheDocument();
  });

  it("excludes soft-deleted kit checks (retiredAt rows never reach the component)", () => {
    // The page filter (`retiredAt: null`) means soft-deleted rows are
    // already pruned upstream. This test simulates that contract: the
    // active row appears, and a row representing a retired check (which
    // the page would have stripped) is absent from the input — and
    // therefore absent from the output.
    const activeCheck = makeKitCheck({
      id: "kit-active",
      epiLotNumber: "LOT-ACTIVE",
    });
    // Note: we do NOT pass the "retired" row at all — that's the
    // upstream contract. The assertion is that nothing that wasn't
    // passed in shows up.
    const { container } = render(
      <EquipmentTab canManage={true} checks={[activeCheck]} />,
    );
    expect(screen.getByText("LOT-ACTIVE")).toBeInTheDocument();
    expect(screen.queryByText("LOT-RETIRED")).not.toBeInTheDocument();
    // Exactly one data row in the kit table body.
    const kitTable = container.querySelectorAll("table")[0] as HTMLElement;
    const dataRows = within(kitTable).getAllByRole("row");
    // header row + 1 data row = 2 rows
    expect(dataRows.length).toBe(2);
  });

  it("renders Edit/Delete affordances when canManage=true", () => {
    render(
      <EquipmentTab canManage={true} checks={[makeKitCheck()]} />,
    );
    // HistoryRowActions renders explicit Edit + Delete buttons.
    expect(
      screen.getAllByRole("button", { name: /edit/i }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("button", { name: /delete/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("hides Edit/Delete affordances when canManage=false", () => {
    render(
      <EquipmentTab canManage={false} checks={[makeKitCheck()]} />,
    );
    // HistoryRowActions returns null entirely when canManage=false. There
    // is also no kit-log form for non-admins, so no Edit/Delete buttons
    // should be present anywhere on the rendered surface.
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
