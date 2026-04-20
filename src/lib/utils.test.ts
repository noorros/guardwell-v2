import { describe, it, expect } from "vitest";
import { cn, scoreToLabel, scoreToColorToken } from "./utils";

describe("cn", () => {
  it("merges + de-conflicts tailwind classes (later wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("handles falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("handles nested arrays + objects (clsx semantics)", () => {
    expect(cn(["a", { b: true, c: false }], "d")).toBe("a b d");
  });
});

describe("scoreToLabel", () => {
  it.each([
    [100, "Compliant"],
    [90, "Compliant"],
    [89, "Good"],
    [70, "Good"],
    [69, "Needs Work"],
    [50, "Needs Work"],
    [49, "At Risk"],
    [0, "At Risk"],
  ] as const)("score %i -> %s", (score, label) => {
    expect(scoreToLabel(score)).toBe(label);
  });
});

describe("scoreToColorToken", () => {
  it.each([
    [95, "var(--gw-color-compliant)"],
    [75, "var(--gw-color-good)"],
    [55, "var(--gw-color-needs)"],
    [25, "var(--gw-color-risk)"],
  ] as const)("score %i -> %s", (score, token) => {
    expect(scoreToColorToken(score)).toBe(token);
  });
});
