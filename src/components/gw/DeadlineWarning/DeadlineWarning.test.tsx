// src/components/gw/DeadlineWarning/DeadlineWarning.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeadlineWarning } from ".";

const FIXED_NOW = new Date("2026-04-20T12:00:00Z");

function addDays(n: number): Date {
  return new Date(FIXED_NOW.getTime() + n * 86_400_000);
}

describe("<DeadlineWarning>", () => {
  it("renders the label", () => {
    render(<DeadlineWarning label="DEA renewal" deadline={addDays(10)} now={FIXED_NOW} />);
    expect(screen.getByText("DEA renewal")).toBeInTheDocument();
  });

  it("renders 'in N days' when deadline is in the future", () => {
    render(<DeadlineWarning label="X" deadline={addDays(10)} now={FIXED_NOW} />);
    expect(screen.getByText(/in 10 days/i)).toBeInTheDocument();
  });

  it("renders 'today' when deadline is today", () => {
    render(<DeadlineWarning label="X" deadline={addDays(0)} now={FIXED_NOW} />);
    expect(screen.getByText(/today/i)).toBeInTheDocument();
  });

  it("renders 'N days overdue' when deadline is past", () => {
    render(<DeadlineWarning label="X" deadline={addDays(-3)} now={FIXED_NOW} />);
    expect(screen.getByText(/3 days overdue/i)).toBeInTheDocument();
  });

  it("renders 'in 1 day' and 'tomorrow' correctly (singular)", () => {
    const { rerender } = render(
      <DeadlineWarning label="X" deadline={addDays(1)} now={FIXED_NOW} />,
    );
    expect(screen.getByText(/in 1 day|tomorrow/i)).toBeInTheDocument();
    rerender(<DeadlineWarning label="X" deadline={addDays(-1)} now={FIXED_NOW} />);
    expect(screen.getByText(/1 day overdue/i)).toBeInTheDocument();
  });

  it("severity color: <=3 days uses --gw-color-risk", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(2)} now={FIXED_NOW} />,
    );
    const el = container.firstElementChild as HTMLElement;
    const style = el.getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-risk)");
  });

  it("severity color: 4-14 days uses --gw-color-needs", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(10)} now={FIXED_NOW} />,
    );
    const style = (container.firstElementChild as HTMLElement).getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-needs)");
  });

  it("severity color: 15-30 days uses --gw-color-good", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(20)} now={FIXED_NOW} />,
    );
    const style = (container.firstElementChild as HTMLElement).getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-good)");
  });

  it("severity color: 30+ days uses --gw-color-compliant", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(60)} now={FIXED_NOW} />,
    );
    const style = (container.firstElementChild as HTMLElement).getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-compliant)");
  });

  it("exposes a polite live-region role so screen readers announce changes", () => {
    render(<DeadlineWarning label="X" deadline={addDays(1)} now={FIXED_NOW} />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
  });

  it("has a machine-readable datetime attribute on <time>", () => {
    const deadline = addDays(10);
    const { container } = render(
      <DeadlineWarning label="X" deadline={deadline} now={FIXED_NOW} />,
    );
    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBe(deadline.toISOString());
  });

  it("carries an icon (redundant signal alongside color)", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(1)} now={FIXED_NOW} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
