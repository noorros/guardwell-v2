// src/app/(dashboard)/programs/risk/RiskRegisterTab.test.tsx
//
// Phase 5 PR 5 — DOM regression for the risk register list. Filter chips
// dispatch via useRouter().push; tests mock both useRouter and
// useSearchParams to drive different filter states without a Next.js
// runtime.

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";

const pushMock = vi.fn();
let searchParams = new URLSearchParams("");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/programs/risk",
}));

import {
  RiskRegisterTab,
  type RiskRegisterRow,
} from "./RiskRegisterTab";

function row(p: Partial<RiskRegisterRow>): RiskRegisterRow {
  return {
    id: p.id ?? `risk-${Math.random().toString(36).slice(2, 8)}`,
    source: p.source ?? "SRA",
    severity: p.severity ?? "MEDIUM",
    title: p.title ?? "Example risk",
    category: p.category ?? "ADMINISTRATIVE",
    status: p.status ?? "OPEN",
    createdAtIso: p.createdAtIso ?? "2026-04-30T12:00:00.000Z",
  };
}

describe("<RiskRegisterTab>", () => {
  beforeEach(() => {
    pushMock.mockReset();
    searchParams = new URLSearchParams("");
  });

  it("renders rows for the input risks", () => {
    render(
      <RiskRegisterTab
        risks={[
          row({ id: "r1", title: "Risk A", severity: "HIGH" }),
          row({ id: "r2", title: "Risk B", severity: "LOW" }),
        ]}
      />,
    );
    expect(screen.getByText("Risk A")).toBeInTheDocument();
    expect(screen.getByText("Risk B")).toBeInTheDocument();
  });

  it("shows the 'no risks' empty state when input is empty", () => {
    render(<RiskRegisterTab risks={[]} />);
    expect(
      screen.getByText(/No open risks\./i),
    ).toBeInTheDocument();
  });

  it("filters by severity (high+critical hides MEDIUM/LOW rows)", () => {
    searchParams = new URLSearchParams("severity=high");
    render(
      <RiskRegisterTab
        risks={[
          row({ id: "r1", title: "Risk A", severity: "HIGH" }),
          row({ id: "r2", title: "Risk B", severity: "LOW" }),
          row({ id: "r3", title: "Risk C", severity: "CRITICAL" }),
        ]}
      />,
    );
    expect(screen.getByText("Risk A")).toBeInTheDocument();
    expect(screen.queryByText("Risk B")).not.toBeInTheDocument();
    expect(screen.getByText("Risk C")).toBeInTheDocument();
  });

  it("filters by source", () => {
    searchParams = new URLSearchParams("source=MANUAL");
    render(
      <RiskRegisterTab
        risks={[
          row({ id: "r1", title: "Risk A", source: "SRA" }),
          row({ id: "r2", title: "Risk B", source: "MANUAL" }),
        ]}
      />,
    );
    expect(screen.queryByText("Risk A")).not.toBeInTheDocument();
    expect(screen.getByText("Risk B")).toBeInTheDocument();
  });

  it("clicking a severity chip pushes the filter into the URL", () => {
    render(
      <RiskRegisterTab
        risks={[row({ id: "r1", title: "Risk A", severity: "HIGH" })]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /high \+ critical/i }),
    );
    expect(pushMock).toHaveBeenCalledTimes(1);
    const arg = pushMock.mock.calls[0]?.[0] as string;
    expect(arg).toContain("severity=high");
    expect(arg).toContain("tab=register");
  });

  it("axe-clean (default render with rows)", async () => {
    const { container } = render(
      <RiskRegisterTab
        risks={[
          row({ id: "r1", title: "Risk A", severity: "HIGH" }),
          row({ id: "r2", title: "Risk B", severity: "MEDIUM" }),
        ]}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
