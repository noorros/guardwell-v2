// src/app/(dashboard)/programs/training/MyTrainingTab.test.tsx
//
// Phase 4 PR 3 — filter-chip regression. Status chips and type chips
// AND together; an empty result set surfaces the "No courses match"
// empty state. Filter buttons must use aria-pressed so screen readers
// announce the current toggle state.

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
import { MyTrainingTab } from "./MyTrainingTab";
import type { ResolvedAssignment } from "@/lib/training/resolveAssignments";

const fixture: ResolvedAssignment[] = [
  {
    id: "asn-1",
    courseId: "course-1",
    courseCode: "HIPAA_BASICS",
    courseTitle: "HIPAA Basics",
    type: "HIPAA",
    durationMinutes: 30,
    dueDate: null,
    requiredFlag: true,
    status: "TO_DO",
    completionScore: null,
    completionExpiresAt: null,
  },
  {
    id: "asn-2",
    courseId: "course-2",
    courseCode: "OSHA_HAZCOM",
    courseTitle: "OSHA Hazcom",
    type: "OSHA",
    durationMinutes: 45,
    dueDate: new Date("2026-01-15T00:00:00Z"),
    requiredFlag: true,
    status: "OVERDUE",
    completionScore: null,
    completionExpiresAt: null,
  },
  {
    id: "asn-3",
    courseId: "course-3",
    courseCode: "OIG_FRAUD",
    courseTitle: "OIG Fraud, Waste, Abuse",
    type: "OIG",
    durationMinutes: 20,
    dueDate: null,
    requiredFlag: true,
    status: "COMPLETED",
    completionScore: 95,
    completionExpiresAt: new Date("2027-01-15T00:00:00Z"),
  },
  {
    id: "asn-4",
    courseId: "course-4",
    courseCode: "HIPAA_ADVANCED",
    courseTitle: "HIPAA Advanced",
    type: "HIPAA",
    durationMinutes: 60,
    dueDate: null,
    requiredFlag: false,
    status: "COMPLETED",
    completionScore: 88,
    completionExpiresAt: new Date("2027-02-01T00:00:00Z"),
  },
];

function renderTab(assignments: ResolvedAssignment[] = fixture) {
  return render(
    <PracticeTimezoneProvider value="America/Phoenix">
      <MyTrainingTab assignments={assignments} />
    </PracticeTimezoneProvider>,
  );
}

describe("<MyTrainingTab>", () => {
  it("renders all four assignments by default (no filter)", () => {
    renderTab();
    expect(screen.getByText("HIPAA Basics")).toBeInTheDocument();
    expect(screen.getByText("OSHA Hazcom")).toBeInTheDocument();
    expect(screen.getByText("OIG Fraud, Waste, Abuse")).toBeInTheDocument();
    expect(screen.getByText("HIPAA Advanced")).toBeInTheDocument();
  });

  it("filters by status (To Do)", async () => {
    renderTab();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^to do$/i }));
    expect(screen.getByText("HIPAA Basics")).toBeInTheDocument();
    expect(screen.queryByText("OSHA Hazcom")).not.toBeInTheDocument();
    expect(screen.queryByText("OIG Fraud, Waste, Abuse")).not.toBeInTheDocument();
    expect(screen.queryByText("HIPAA Advanced")).not.toBeInTheDocument();
  });

  it("filters by status (Completed) and surfaces aria-pressed", async () => {
    renderTab();
    const user = userEvent.setup();
    const completedBtn = screen.getByRole("button", { name: /^completed$/i });
    expect(completedBtn).toHaveAttribute("aria-pressed", "false");
    await user.click(completedBtn);
    expect(completedBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("HIPAA Basics")).not.toBeInTheDocument();
    expect(screen.getByText("OIG Fraud, Waste, Abuse")).toBeInTheDocument();
    expect(screen.getByText("HIPAA Advanced")).toBeInTheDocument();
  });

  it("filters by status (Overdue)", async () => {
    renderTab();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^overdue$/i }));
    expect(screen.getByText("OSHA Hazcom")).toBeInTheDocument();
    expect(screen.queryByText("HIPAA Basics")).not.toBeInTheDocument();
    expect(screen.queryByText("OIG Fraud, Waste, Abuse")).not.toBeInTheDocument();
  });

  it("filters by type (HIPAA only)", async () => {
    renderTab();
    const user = userEvent.setup();
    const hipaaBtn = screen
      .getByRole("group", { name: /filter by type/i })
      .querySelector("button[aria-pressed]");
    expect(hipaaBtn).toBeTruthy();
    // Find the HIPAA chip specifically (could be ordered by sort).
    const typeGroup = screen.getByRole("group", { name: /filter by type/i });
    const hipaaChip = Array.from(
      typeGroup.querySelectorAll("button"),
    ).find((b) => b.textContent === "HIPAA");
    expect(hipaaChip).toBeTruthy();
    await user.click(hipaaChip!);
    expect(screen.getByText("HIPAA Basics")).toBeInTheDocument();
    expect(screen.getByText("HIPAA Advanced")).toBeInTheDocument();
    expect(screen.queryByText("OSHA Hazcom")).not.toBeInTheDocument();
    expect(screen.queryByText("OIG Fraud, Waste, Abuse")).not.toBeInTheDocument();
  });

  it("ANDs status filter + type filter together", async () => {
    renderTab();
    const user = userEvent.setup();
    // Status: Completed
    await user.click(screen.getByRole("button", { name: /^completed$/i }));
    // Type: HIPAA (only)
    const typeGroup = screen.getByRole("group", { name: /filter by type/i });
    const hipaaChip = Array.from(
      typeGroup.querySelectorAll("button"),
    ).find((b) => b.textContent === "HIPAA");
    await user.click(hipaaChip!);
    // Result: only HIPAA Advanced (HIPAA + COMPLETED). HIPAA Basics is
    // HIPAA but TO_DO; OIG Fraud is COMPLETED but not HIPAA.
    expect(screen.getByText("HIPAA Advanced")).toBeInTheDocument();
    expect(screen.queryByText("HIPAA Basics")).not.toBeInTheDocument();
    expect(screen.queryByText("OIG Fraud, Waste, Abuse")).not.toBeInTheDocument();
  });

  it("shows the empty state when filters produce zero rows", async () => {
    renderTab();
    const user = userEvent.setup();
    // Overdue + filter type to OIG → no rows match.
    await user.click(screen.getByRole("button", { name: /^overdue$/i }));
    const typeGroup = screen.getByRole("group", { name: /filter by type/i });
    const oigChip = Array.from(
      typeGroup.querySelectorAll("button"),
    ).find((b) => b.textContent === "OIG");
    await user.click(oigChip!);
    expect(
      screen.getByText(/no courses match your filters/i),
    ).toBeInTheDocument();
  });

  it("shows the unassigned empty state when assignments[] is empty", () => {
    renderTab([]);
    expect(
      screen.getByText(/no training assigned/i),
    ).toBeInTheDocument();
  });

  it("axe-clean (default render)", async () => {
    const { container } = renderTab();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("axe-clean (empty assignments)", async () => {
    const { container } = renderTab([]);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
