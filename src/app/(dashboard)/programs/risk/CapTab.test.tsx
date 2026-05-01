// src/app/(dashboard)/programs/risk/CapTab.test.tsx
//
// Phase 5 PR 6 — DOM regression for the CAP timeline tab. No router
// dispatch involved (rows are <Link>s); the only stateful behaviour is
// the OVERDUE derivation via effectiveCapStatus().
//
// Cases:
//   - empty state shows the "No corrective actions yet" message
//   - renders one card per CAP with the description visible
//   - past-due PENDING row gets the "Overdue" destructive badge
//   - COMPLETED row gets the "Completed" secondary badge
//   - jest-axe scan passes

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { CapTab, type CapTabProps } from "./CapTab";

type CapRow = CapTabProps["caps"][number];

function row(p: Partial<CapRow>): CapRow {
  return {
    id: p.id ?? `cap-${Math.random().toString(36).slice(2, 8)}`,
    description: p.description ?? "Example corrective action",
    status: p.status ?? "PENDING",
    dueDate: p.dueDate ?? null,
    createdAt: p.createdAt ?? new Date("2026-04-01T00:00:00.000Z"),
    ownerUserId: p.ownerUserId ?? null,
    riskItemId: p.riskItemId ?? null,
    sourceAlertId: p.sourceAlertId ?? null,
  };
}

describe("<CapTab>", () => {
  it("shows the 'no corrective actions yet' empty state when input is empty", () => {
    render(<CapTab caps={[]} />);
    expect(
      screen.getByText(/No corrective actions yet/i),
    ).toBeInTheDocument();
  });

  it("renders one card per CAP with the description visible", () => {
    render(
      <CapTab
        caps={[
          row({ id: "c1", description: "Patch encryption gap" }),
          row({ id: "c2", description: "Renew SSL certificates" }),
        ]}
      />,
    );
    expect(screen.getByText("Patch encryption gap")).toBeInTheDocument();
    expect(screen.getByText("Renew SSL certificates")).toBeInTheDocument();
  });

  it("renders an Overdue badge for a past-due PENDING row", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { container } = render(
      <CapTab
        caps={[
          row({
            id: "overdue-1",
            description: "Patch encryption gap",
            status: "PENDING",
            dueDate: yesterday,
          }),
        ]}
      />,
    );
    // The badge is the only element with data-slot="badge"; assert
    // exactly its text content rather than a regex over the whole DOM
    // (otherwise we'd also match descriptions that happen to contain
    // the word).
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("Overdue");
  });

  it("renders a Completed badge for a COMPLETED row regardless of due date", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { container } = render(
      <CapTab
        caps={[
          row({
            id: "done-1",
            description: "Finished work",
            status: "COMPLETED",
            // Past due, but COMPLETED short-circuits OVERDUE derivation.
            dueDate: yesterday,
          }),
        ]}
      />,
    );
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("Completed");
  });

  it("axe-clean (default render with mixed-status rows)", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { container } = render(
      <CapTab
        caps={[
          row({
            id: "c1",
            description: "Overdue",
            status: "PENDING",
            dueDate: yesterday,
          }),
          row({
            id: "c2",
            description: "Pending",
            status: "PENDING",
            dueDate: tomorrow,
          }),
          row({
            id: "c3",
            description: "Completed",
            status: "COMPLETED",
          }),
        ]}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
