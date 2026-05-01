// @vitest-environment node
import { describe, it, expect } from "vitest";
import { effectiveCapStatus } from "./capStatus";

describe("effectiveCapStatus", () => {
  const future = new Date("2099-01-01T00:00:00Z");
  const past = new Date("2020-01-01T00:00:00Z");

  it("returns COMPLETED when status is COMPLETED, even if dueDate passed", () => {
    expect(effectiveCapStatus("COMPLETED", past)).toBe("COMPLETED");
  });
  it("returns OVERDUE when PENDING + dueDate < now", () => {
    expect(effectiveCapStatus("PENDING", past)).toBe("OVERDUE");
  });
  it("returns OVERDUE when IN_PROGRESS + dueDate < now", () => {
    expect(effectiveCapStatus("IN_PROGRESS", past)).toBe("OVERDUE");
  });
  it("returns PENDING when PENDING + dueDate > now", () => {
    expect(effectiveCapStatus("PENDING", future)).toBe("PENDING");
  });
  it("returns IN_PROGRESS when IN_PROGRESS + dueDate > now", () => {
    expect(effectiveCapStatus("IN_PROGRESS", future)).toBe("IN_PROGRESS");
  });
  it("returns PENDING when no dueDate set", () => {
    expect(effectiveCapStatus("PENDING", null)).toBe("PENDING");
  });
});
