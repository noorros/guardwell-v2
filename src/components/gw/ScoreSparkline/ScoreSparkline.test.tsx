// src/components/gw/ScoreSparkline/ScoreSparkline.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import {
  ScoreSparkline,
  computeDailyCompliantCounts,
  type StatusFlipEvent,
} from ".";

describe("computeDailyCompliantCounts", () => {
  const NOW = new Date("2026-04-23T12:00:00Z");

  it("returns an array of `days` length, oldest first", () => {
    const result = computeDailyCompliantCounts(5, [], 7, NOW);
    expect(result).toHaveLength(7);
    // No events → flat trend.
    expect(result.every((v) => v === 5)).toBe(true);
  });

  it("subtracts a recent NOT_STARTED→COMPLIANT flip from earlier days", () => {
    // Today: 5 compliant. 2 days ago someone flipped a requirement
    // NOT_STARTED→COMPLIANT. So 3 days ago and earlier had 4 compliant.
    const events: StatusFlipEvent[] = [
      {
        createdAt: new Date("2026-04-21T10:00:00Z"),
        previousStatus: "NOT_STARTED",
        nextStatus: "COMPLIANT",
      },
    ];
    const result = computeDailyCompliantCounts(5, events, 7, NOW);
    // result[6] = today = 5. result[0] = 7d ago.
    expect(result[6]).toBe(5);
    expect(result[5]).toBe(5); // yesterday = 5 (event 2d ago is included)
    expect(result[0]).toBe(4); // before the event = 4
  });

  it("adds a recent COMPLIANT→GAP flip back when reversing (count of 'end of day')", () => {
    // Today: 5. Yesterday a requirement flipped COMPLIANT→GAP. End of
    // yesterday: 5 (after the flip). End of 2 days ago: 6 (before).
    const events: StatusFlipEvent[] = [
      {
        createdAt: new Date("2026-04-22T10:00:00Z"),
        previousStatus: "COMPLIANT",
        nextStatus: "GAP",
      },
    ];
    const result = computeDailyCompliantCounts(5, events, 7, NOW);
    expect(result[6]).toBe(5); // end of today
    expect(result[5]).toBe(5); // end of yesterday — after the flip
    expect(result[4]).toBe(6); // end of 2 days ago — before the flip
  });

  it("ignores no-op COMPLIANT→COMPLIANT flips", () => {
    const events: StatusFlipEvent[] = [
      {
        createdAt: new Date("2026-04-22T10:00:00Z"),
        previousStatus: "COMPLIANT",
        nextStatus: "COMPLIANT",
      },
    ];
    const result = computeDailyCompliantCounts(5, events, 7, NOW);
    expect(result.every((v) => v === 5)).toBe(true);
  });
});

describe("<ScoreSparkline>", () => {
  it("renders nothing when given fewer than 2 points", () => {
    const { container } = render(<ScoreSparkline points={[]} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<ScoreSparkline points={[5]} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("renders an SVG with a path for ≥2 points", () => {
    const { container } = render(<ScoreSparkline points={[1, 2, 3]} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(container.querySelector("path")).not.toBeNull();
  });

  it("uses the provided aria-label override", () => {
    const { container } = render(
      <ScoreSparkline points={[1, 2, 3]} ariaLabel="custom" />,
    );
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      "custom",
    );
  });

  it("computes a trending-up default aria-label when last > first", async () => {
    const { container } = render(<ScoreSparkline points={[1, 5]} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toMatch(/up 4/);
  });

  it("passes axe with no violations", async () => {
    const { container } = render(<ScoreSparkline points={[1, 2, 3, 4, 5]} />);
    const results = await axe(container, {
      rules: { region: { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
