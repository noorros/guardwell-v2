import { describe, it, expect } from "vitest";
import { computeUserInitials } from "@/lib/utils";

describe("computeUserInitials", () => {
  it("returns first 2 letters of email when no name available", () => {
    expect(computeUserInitials("alice@example.com")).toBe("AL");
  });
  it("returns first letter of each name part when name has space", () => {
    expect(computeUserInitials("alice@example.com", "Alice Smith")).toBe("AS");
  });
  it("falls back to the first 2 letters of the first name part if only one part", () => {
    expect(computeUserInitials("alice@example.com", "Alice")).toBe("AL");
  });
  it("returns ?? for empty string email", () => {
    expect(computeUserInitials("")).toBe("??");
  });
  it("uppercases lowercase initials", () => {
    expect(computeUserInitials("z@z.com", "kim park")).toBe("KP");
  });
});
