// src/app/(dashboard)/programs/training/assignments/AssignmentsGrid.test.tsx
//
// Phase 4 PR 5 — DOM regression for the assignments grid. Status logic
// is exhaustively unit-tested in src/lib/training/resolveGrid.test.ts;
// these tests cover the rendering surface only:
//
//   - Renders 2 rows × 3 cols for the fixture data
//   - Each status (COMPLETED / TO_DO / OVERDUE / IN_PROGRESS / NOT_ASSIGNED)
//     produces the expected visible text
//   - Header cells use scope="col" + scope="row" for screen-reader nav
//   - jest-axe scan passes
//   - Empty staff and empty courses both surface their respective
//     zero-state copy

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { AssignmentsGrid } from "./AssignmentsGrid";
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
import type { GridCellRecord, GridStaffRow, GridCourseColumn } from "./page";

const STAFF: GridStaffRow[] = [
  {
    userId: "u-alice",
    displayName: "alice@example.test",
    role: "STAFF",
    category: null,
  },
  {
    userId: "u-bob",
    displayName: "bob@example.test",
    role: "ADMIN",
    category: null,
  },
];

const COURSES: GridCourseColumn[] = [
  { id: "c-hipaa", code: "HIPAA_BASICS", title: "HIPAA Basics", type: "HIPAA" },
  { id: "c-osha", code: "OSHA_HAZCOM", title: "OSHA HazCom", type: "OSHA" },
  { id: "c-oig", code: "OIG_FRAUD", title: "OIG Fraud", type: "OIG" },
];

// Pin the formatted date so the test is deterministic. America/Phoenix
// matches the resolved timezone used by other component tests.
const COMPLETED_AT_ISO = "2026-04-15T16:00:00Z";

const CELLS: GridCellRecord = {
  "u-alice": {
    "c-hipaa": {
      status: "COMPLETED",
      completedAtIso: COMPLETED_AT_ISO,
      dueDateIso: null,
    },
    "c-osha": {
      status: "OVERDUE",
      completedAtIso: null,
      dueDateIso: "2026-03-01T00:00:00Z",
    },
    "c-oig": {
      status: "IN_PROGRESS",
      completedAtIso: null,
      dueDateIso: null,
    },
  },
  "u-bob": {
    "c-hipaa": {
      status: "TO_DO",
      completedAtIso: "2024-01-01T00:00:00Z",
      dueDateIso: null,
    },
    "c-osha": {
      status: "NOT_ASSIGNED",
      completedAtIso: null,
      dueDateIso: null,
    },
    "c-oig": {
      status: "NOT_ASSIGNED",
      completedAtIso: null,
      dueDateIso: null,
    },
  },
};

function renderGrid(props: Partial<Parameters<typeof AssignmentsGrid>[0]> = {}) {
  return render(
    <PracticeTimezoneProvider value="America/Phoenix">
      <AssignmentsGrid
        staff={props.staff ?? STAFF}
        courses={props.courses ?? COURSES}
        cells={props.cells ?? CELLS}
      />
    </PracticeTimezoneProvider>,
  );
}

describe("<AssignmentsGrid>", () => {
  it("renders one row per staff and one column per course (2×3 fixture)", () => {
    renderGrid();
    // 1 header row + 2 body rows
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    // 1 staff col + 3 course cols = 4 column headers
    const colHeaders = screen.getAllByRole("columnheader");
    expect(colHeaders).toHaveLength(4);
    // 2 row headers (one per staff)
    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(2);
  });

  it("uses scope='col' on course headers and scope='row' on staff cells (a11y for table nav)", () => {
    const { container } = renderGrid();
    const colHeaders = container.querySelectorAll("th[scope='col']");
    expect(colHeaders.length).toBe(4); // staff col + 3 course cols
    const rowHeaders = container.querySelectorAll("th[scope='row']");
    expect(rowHeaders.length).toBe(2); // 2 staff rows
  });

  it("renders course titles in column headers", () => {
    renderGrid();
    expect(screen.getByText("HIPAA Basics")).toBeInTheDocument();
    expect(screen.getByText("OSHA HazCom")).toBeInTheDocument();
    expect(screen.getByText("OIG Fraud")).toBeInTheDocument();
  });

  it("renders staff display names in row headers", () => {
    renderGrid();
    expect(screen.getByText("alice@example.test")).toBeInTheDocument();
    expect(screen.getByText("bob@example.test")).toBeInTheDocument();
  });

  it("COMPLETED cell shows 'Completed <date>'", () => {
    renderGrid();
    // April 15 in America/Phoenix (UTC-7) for the 16:00 UTC source.
    expect(screen.getByText(/Completed Apr 15, 2026/)).toBeInTheDocument();
  });

  it("OVERDUE cell shows 'Overdue' badge", () => {
    renderGrid();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("IN_PROGRESS cell shows 'In Progress' badge", () => {
    renderGrid();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("TO_DO cell shows 'Expired · retake' badge", () => {
    renderGrid();
    expect(screen.getByText(/Expired · retake/)).toBeInTheDocument();
  });

  it("NOT_ASSIGNED cell shows '—' with aria-label='Not assigned'", () => {
    renderGrid();
    const dashes = screen.getAllByLabelText("Not assigned");
    expect(dashes.length).toBe(2); // u-bob has 2 NOT_ASSIGNED cells in the fixture
    expect(dashes[0]?.textContent).toBe("—");
  });

  it("renders the empty-staff state when no staff are passed", () => {
    renderGrid({ staff: [] });
    expect(
      screen.getByText(/no active staff members yet/i),
    ).toBeInTheDocument();
  });

  it("renders the empty-courses state when no courses are passed", () => {
    renderGrid({ courses: [] });
    expect(
      screen.getByText(/no required courses are currently in the catalog/i),
    ).toBeInTheDocument();
  });

  it("axe-clean (default render)", async () => {
    const { container } = renderGrid();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("axe-clean (empty staff)", async () => {
    const { container } = renderGrid({ staff: [] });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("axe-clean (empty courses)", async () => {
    const { container } = renderGrid({ courses: [] });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
