// src/app/(dashboard)/programs/training/manage/ManageCoursesTab.test.tsx
//
// Phase 4 PR 4 — DOM regression for the Manage Courses table. We mock
// the lifecycle server actions + CreateCourseForm so this test stays
// pure presentational; the actions themselves are exercised by the
// integration test in tests/integration/training-course-lifecycle.test.ts.

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ManageCoursesTab } from "./ManageCoursesTab";
import type { ManageCourseRow } from "./page";

// Mock next/navigation router so router.refresh() is a no-op in tests.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// Mock the server-action module so we can spy on retire/restore calls
// without touching the DB. CreateCourseForm is also mocked so we don't
// need to render its full form tree just to test the table.
const retireMock = vi.fn();
const restoreMock = vi.fn();
vi.mock("../actions", () => ({
  retireTrainingCourseAction: (...args: unknown[]) => retireMock(...args),
  restoreTrainingCourseAction: (...args: unknown[]) => restoreMock(...args),
}));
vi.mock("./CreateCourseForm", () => ({
  CreateCourseForm: () => <div data-testid="create-course-form-stub" />,
}));

beforeEach(() => {
  retireMock.mockReset();
  restoreMock.mockReset();
  retireMock.mockResolvedValue({ courseId: "noop" });
  restoreMock.mockResolvedValue({ courseId: "noop" });
});

const fixture: ManageCourseRow[] = [
  {
    id: "sys-1",
    code: "HIPAA_BASICS",
    title: "HIPAA Basics",
    type: "HIPAA",
    version: 3,
    sortOrder: 1,
    isCustom: false,
    isRetired: false,
  },
  {
    id: "cus-active",
    code: "cmo7thv9aaaaaaaaaaaaaaaaa_MY_COURSE",
    title: "My Active Custom",
    type: "CUSTOM",
    version: 1,
    sortOrder: 999,
    isCustom: true,
    isRetired: false,
  },
  {
    id: "cus-retired",
    code: "cmo7thv9aaaaaaaaaaaaaaaaa_OLD_COURSE",
    title: "My Retired Custom",
    type: "CUSTOM",
    version: 2,
    sortOrder: 9999,
    isCustom: true,
    isRetired: true,
  },
];

describe("<ManageCoursesTab>", () => {
  it("renders all rows including system + custom (active + retired)", () => {
    render(<ManageCoursesTab rows={fixture} />);
    expect(screen.getByText("HIPAA Basics")).toBeInTheDocument();
    expect(screen.getByText("My Active Custom")).toBeInTheDocument();
    expect(screen.getByText("My Retired Custom")).toBeInTheDocument();
  });

  it("hides Retire/Restore buttons on system rows (em-dash placeholder)", () => {
    render(<ManageCoursesTab rows={fixture} />);
    // Locate the row whose title is HIPAA Basics, then assert no
    // Retire/Restore button lives in it.
    const row = screen.getByText("HIPAA Basics").closest("tr")!;
    expect(row).toBeTruthy();
    expect(
      row.querySelector("button"),
    ).toBeNull();
  });

  it("shows Retire button on active custom rows", () => {
    render(<ManageCoursesTab rows={fixture} />);
    const row = screen.getByText("My Active Custom").closest("tr")!;
    const btn = row.querySelector("button");
    expect(btn?.textContent?.toLowerCase()).toMatch(/retire/);
  });

  it("shows Restore button on retired custom rows", () => {
    render(<ManageCoursesTab rows={fixture} />);
    const row = screen.getByText("My Retired Custom").closest("tr")!;
    const btn = row.querySelector("button");
    expect(btn?.textContent?.toLowerCase()).toMatch(/restore/);
  });

  it("clicking Retire calls retireTrainingCourseAction with the row's id", async () => {
    render(<ManageCoursesTab rows={fixture} />);
    const user = userEvent.setup();
    const row = screen.getByText("My Active Custom").closest("tr")!;
    const btn = row.querySelector("button")!;
    await user.click(btn);
    expect(retireMock).toHaveBeenCalledWith({ courseId: "cus-active" });
  });

  it("clicking Restore calls restoreTrainingCourseAction with the row's id", async () => {
    render(<ManageCoursesTab rows={fixture} />);
    const user = userEvent.setup();
    const row = screen.getByText("My Retired Custom").closest("tr")!;
    const btn = row.querySelector("button")!;
    await user.click(btn);
    expect(restoreMock).toHaveBeenCalledWith({ courseId: "cus-retired" });
  });

  it("displays an error banner when the action throws", async () => {
    retireMock.mockRejectedValueOnce(new Error("boom"));
    render(<ManageCoursesTab rows={fixture} />);
    const user = userEvent.setup();
    const row = screen.getByText("My Active Custom").closest("tr")!;
    await user.click(row.querySelector("button")!);
    // The transition resolves; alert role should appear with the message.
    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/);
  });

  it("renders the empty state when rows[] is empty", () => {
    render(<ManageCoursesTab rows={[]} />);
    expect(
      screen.getByText(/no courses in the catalog yet/i),
    ).toBeInTheDocument();
  });

  it("axe-clean (default render)", async () => {
    const { container } = render(<ManageCoursesTab rows={fixture} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("axe-clean (empty rows)", async () => {
    const { container } = render(<ManageCoursesTab rows={[]} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
