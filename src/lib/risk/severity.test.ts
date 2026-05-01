// @vitest-environment node
import { describe, it, expect } from "vitest";
import { riskSeverityBadgeVariant, riskSeverityLabel } from "./severity";

describe("riskSeverityBadgeVariant", () => {
  it("maps CRITICAL to destructive", () => {
    expect(riskSeverityBadgeVariant("CRITICAL")).toBe("destructive");
  });
  it("maps HIGH to destructive", () => {
    expect(riskSeverityBadgeVariant("HIGH")).toBe("destructive");
  });
  it("maps MEDIUM to default", () => {
    expect(riskSeverityBadgeVariant("MEDIUM")).toBe("default");
  });
  it("maps LOW to secondary", () => {
    expect(riskSeverityBadgeVariant("LOW")).toBe("secondary");
  });
  it("maps INFO to secondary", () => {
    expect(riskSeverityBadgeVariant("INFO")).toBe("secondary");
  });
  it("maps unknown values to secondary", () => {
    expect(riskSeverityBadgeVariant("BOGUS")).toBe("secondary");
  });
});

describe("riskSeverityLabel", () => {
  it("title-cases known values", () => {
    expect(riskSeverityLabel("HIGH")).toBe("High");
    expect(riskSeverityLabel("CRITICAL")).toBe("Critical");
  });
});
