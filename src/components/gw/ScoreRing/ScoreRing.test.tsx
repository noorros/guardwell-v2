import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreRing } from ".";

describe("<ScoreRing>", () => {
  it("renders the score as integer text", () => {
    render(<ScoreRing score={87} />);
    expect(screen.getByText("87")).toBeInTheDocument();
  });

  it("clamps scores above 100 and below 0", () => {
    const { rerender } = render(<ScoreRing score={150} />);
    expect(screen.getByText("100")).toBeInTheDocument();
    rerender(<ScoreRing score={-5} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("rounds fractional scores (no '87.4' leaking into UI)", () => {
    render(<ScoreRing score={87.4} />);
    expect(screen.getByText("87")).toBeInTheDocument();
  });

  it("maps score -> stroke token: 95 uses compliant color", () => {
    const { container } = render(<ScoreRing score={95} />);
    const fg = container.querySelector("circle[data-role='fg']");
    expect(fg?.getAttribute("stroke")).toBe("var(--gw-color-compliant)");
  });

  it.each([
    [95, "var(--gw-color-compliant)"],
    [75, "var(--gw-color-good)"],
    [55, "var(--gw-color-needs)"],
    [25, "var(--gw-color-risk)"],
  ] as const)("score %i maps to color token %s", (score, token) => {
    const { container } = render(<ScoreRing score={score} />);
    const fg = container.querySelector("circle[data-role='fg']");
    expect(fg?.getAttribute("stroke")).toBe(token);
  });

  it("exposes an accessible name via aria-labelledby when label is passed", () => {
    const { container } = render(<ScoreRing score={80} label="HIPAA Privacy" />);
    const svg = container.querySelector("svg");
    const labelledBy = svg?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    // The referenced element exists and contains useful text
    const labelEl = labelledBy && document.getElementById(labelledBy);
    expect(labelEl?.textContent).toMatch(/HIPAA Privacy/);
  });

  it("includes a screen-reader-only sentence combining score + label text (redundant signal)", () => {
    render(<ScoreRing score={45} label="Security Rule" />);
    // jest-dom's matcher finds text regardless of visual hiding
    expect(
      screen.getByText(/Security Rule: 45 out of 100, At Risk/i),
    ).toBeInTheDocument();
  });

  it("stroke-dashoffset reflects the score (progress = score / 100)", () => {
    const { container } = render(<ScoreRing score={50} size={100} strokeWidth={10} />);
    const fg = container.querySelector("circle[data-role='fg']") as SVGCircleElement | null;
    const dasharray = fg?.getAttribute("stroke-dasharray");
    const dashoffset = fg?.getAttribute("stroke-dashoffset");
    expect(dasharray).toBeTruthy();
    expect(dashoffset).toBeTruthy();
    // At 50%, offset should equal half the circumference.
    const circumference = Number(dasharray);
    const offset = Number(dashoffset);
    expect(Math.abs(offset - circumference / 2)).toBeLessThan(0.5);
  });
});
