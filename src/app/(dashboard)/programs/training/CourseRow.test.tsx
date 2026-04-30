// src/app/(dashboard)/programs/training/CourseRow.test.tsx
//
// Phase 4 PR 3 — DOM regression test for the per-assignment row.
// CTA label flips on the resolved status:
//   TO_DO → "Start", IN_PROGRESS → "Resume", COMPLETED → "Retake",
//   OVERDUE → "Start" + visible Overdue badge.
// Every row's CTA must link to /programs/training/[courseId].

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
import { CourseRow, type CourseRowProps } from "./CourseRow";

const baseProps: CourseRowProps = {
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
};

function renderRow(overrides: Partial<CourseRowProps> = {}) {
  return render(
    <PracticeTimezoneProvider value="America/Phoenix">
      <CourseRow {...baseProps} {...overrides} />
    </PracticeTimezoneProvider>,
  );
}

describe("<CourseRow>", () => {
  it("renders 'Start' CTA when status is TO_DO", () => {
    renderRow({ status: "TO_DO" });
    const link = screen.getByRole("link", { name: /start/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/programs/training/course-1");
  });

  it("renders 'Resume' CTA when status is IN_PROGRESS", () => {
    renderRow({ status: "IN_PROGRESS" });
    const link = screen.getByRole("link", { name: /resume/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/programs/training/course-1");
  });

  it("renders 'Retake' CTA when status is COMPLETED", () => {
    renderRow({
      status: "COMPLETED",
      completionScore: 95,
      completionExpiresAt: new Date("2027-01-15T00:00:00Z"),
    });
    const link = screen.getByRole("link", { name: /retake/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/programs/training/course-1");
  });

  it("renders 'Start' CTA AND a visible Overdue badge when status is OVERDUE", () => {
    renderRow({
      status: "OVERDUE",
      dueDate: new Date("2026-01-15T00:00:00Z"),
    });
    expect(
      screen.getByRole("link", { name: /start/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it("links to /programs/training/[courseId]", () => {
    renderRow({ courseId: "course-xyz", status: "TO_DO" });
    const link = screen.getByRole("link", { name: /start/i });
    expect(link.getAttribute("href")).toBe("/programs/training/course-xyz");
  });

  it("renders the course title and type badge", () => {
    renderRow({ courseTitle: "OSHA Hazcom", type: "OSHA" });
    expect(screen.getByText("OSHA Hazcom")).toBeInTheDocument();
    expect(screen.getByText("OSHA")).toBeInTheDocument();
  });

  it("axe-clean (TO_DO)", async () => {
    const { container } = renderRow({ status: "TO_DO" });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("axe-clean (COMPLETED with score and expiry)", async () => {
    const { container } = renderRow({
      status: "COMPLETED",
      completionScore: 95,
      completionExpiresAt: new Date("2027-01-15T00:00:00Z"),
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("axe-clean (OVERDUE)", async () => {
    const { container } = renderRow({
      status: "OVERDUE",
      dueDate: new Date("2026-01-15T00:00:00Z"),
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
