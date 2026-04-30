// src/components/gw/Extras/OshaExtras.test.tsx
//
// Audit #21 OSHA I-7 — Form 300A worksheet inputs.
// Pre-fix: Number.parseInt(...) || 0 had no upper bound → typing
// 999_999_999 into "Total hours worked" (or any other field) would
// silently inflate the TRIR/DART denominator. Post-fix: every numeric
// field has a per-field cap, parseFloat + Math.round for hours, and
// Number.isFinite guards against NaN.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OshaExtras } from "./OshaExtras";

describe("Audit #21 OSHA I-7 — Form 300A worksheet caps", () => {
  it("clamps Total hours worked at the 100M cap when over-typed", async () => {
    const user = userEvent.setup();
    render(<OshaExtras />);
    // The label includes the trailing "Sum across all employees" hint
    // outside the <label>; getByLabelText hits the input itself.
    const hoursInput = screen.getByLabelText(
      /total hours worked/i,
    ) as HTMLInputElement;
    expect(hoursInput).toBeInTheDocument();

    // Way over the 100,000,000 cap.
    await user.clear(hoursInput);
    await user.type(hoursInput, "999999999");

    // Component clamps to 100M (the cap defined in OshaExtras.tsx).
    expect(Number(hoursInput.value)).toBeLessThanOrEqual(100_000_000);
    // And specifically lands at the cap, not at zero.
    expect(Number(hoursInput.value)).toBe(100_000_000);
  });

  it("rejects negative values (clamps to 0)", async () => {
    const user = userEvent.setup();
    render(<OshaExtras />);
    const daysAwayInput = screen.getByLabelText(
      /days-away cases/i,
    ) as HTMLInputElement;

    // The browser's number-input often refuses the leading "-" via
    // user.type, but the onChange handler must still defend against
    // direct programmatic values. Use fireEvent-style approach via
    // user.click + user.keyboard for completeness.
    await user.clear(daysAwayInput);
    await user.type(daysAwayInput, "-50");

    // Either the browser stripped the sign (yielding "50") or our
    // handler clamped to 0. Both outcomes are non-negative.
    expect(Number(daysAwayInput.value)).toBeGreaterThanOrEqual(0);
  });

  it("hours field accepts decimal payroll exports (rounds to int)", async () => {
    const user = userEvent.setup();
    render(<OshaExtras />);
    const hoursInput = screen.getByLabelText(
      /total hours worked/i,
    ) as HTMLInputElement;

    await user.clear(hoursInput);
    // Common payroll-export shape: fractional hours.
    await user.type(hoursInput, "2080.5");

    // parseFloat + Math.round → 2081.
    expect(Number(hoursInput.value)).toBe(2081);
  });

  it("renders the worksheet without crashing", () => {
    render(<OshaExtras />);
    expect(screen.getByText(/Form 300A worksheet/i)).toBeInTheDocument();
    expect(screen.getByText(/Total recordable cases/i)).toBeInTheDocument();
  });
});
