// src/app/(dashboard)/programs/training/TrainingDashboard.test.tsx
//
// Phase 4 PR 3 — orchestrator-level regression. Pins:
//   - canManage gates the admin-only tab triggers
//   - KPI band reflects the props verbatim
//   - jest-axe scan stays clean

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
import { TrainingDashboard } from "./TrainingDashboard";

const baseProgress = {
  completed: 3,
  inProgress: 0,
  toDo: 2,
  teamCompletions: 17,
};

function renderDashboard(opts: { canManage: boolean }) {
  return render(
    <PracticeTimezoneProvider value="America/Phoenix">
      <TrainingDashboard
        canManage={opts.canManage}
        myProgress={baseProgress}
        myAssignments={[]}
      />
    </PracticeTimezoneProvider>,
  );
}

describe("<TrainingDashboard>", () => {
  it("renders only My Training when canManage=false", () => {
    renderDashboard({ canManage: false });
    expect(screen.getByRole("tab", { name: /my training/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /manage courses/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /^assignments$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders all three tabs when canManage=true", () => {
    renderDashboard({ canManage: true });
    expect(screen.getByRole("tab", { name: /my training/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /manage courses/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /^assignments$/i }),
    ).toBeInTheDocument();
  });

  it("renders the KPI band with the resolved progress numbers", () => {
    renderDashboard({ canManage: true });
    // 3 completed, 2 to-do, 0 in-progress → 3 / 5 = 60%.
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
  });

  it("shows 0% progress when no assignments exist", () => {
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <TrainingDashboard
          canManage={false}
          myProgress={{
            completed: 0,
            inProgress: 0,
            toDo: 0,
            teamCompletions: 0,
          }}
          myAssignments={[]}
        />
      </PracticeTimezoneProvider>,
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("axe-clean (canManage=false)", async () => {
    const { container } = renderDashboard({ canManage: false });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("axe-clean (canManage=true)", async () => {
    const { container } = renderDashboard({ canManage: true });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
