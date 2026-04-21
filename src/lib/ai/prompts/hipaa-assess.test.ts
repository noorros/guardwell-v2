// src/lib/ai/prompts/hipaa-assess.test.ts
import { describe, it, expect } from "vitest";
import {
  hipaaAssessInputSchema,
  hipaaAssessOutputSchema,
  HIPAA_ASSESS_SYSTEM,
} from "./hipaa-assess";

describe("hipaa.assess.v1 schemas", () => {
  it("inputSchema accepts a minimal valid practice", () => {
    expect(
      hipaaAssessInputSchema.parse({
        practiceName: "Test Clinic",
        primaryState: "AZ",
        requirementCodes: ["HIPAA_PRIVACY_OFFICER"],
      }),
    ).toBeTruthy();
  });

  it("inputSchema rejects 0 requirement codes", () => {
    expect(() =>
      hipaaAssessInputSchema.parse({
        practiceName: "X",
        primaryState: "AZ",
        requirementCodes: [],
      }),
    ).toThrow();
  });

  it("outputSchema rejects a reason shorter than 10 chars", () => {
    expect(() =>
      hipaaAssessOutputSchema.parse({
        suggestions: [
          { requirementCode: "A", likelyStatus: "GAP", reason: "nope" },
        ],
      }),
    ).toThrow();
  });

  it("outputSchema rejects unknown likelyStatus values", () => {
    expect(() =>
      hipaaAssessOutputSchema.parse({
        suggestions: [
          {
            requirementCode: "A",
            likelyStatus: "UNKNOWN",
            reason: "short reason 01",
          },
        ],
      }),
    ).toThrow();
  });

  it("system prompt references the tool by name and forbids free text", () => {
    expect(HIPAA_ASSESS_SYSTEM).toMatch(/hipaa_assess_v1/);
    expect(HIPAA_ASSESS_SYSTEM).toMatch(/tool/);
  });
});
