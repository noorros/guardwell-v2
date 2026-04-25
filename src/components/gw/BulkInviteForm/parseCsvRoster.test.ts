import { describe, it, expect } from "vitest";
import { parseCsvRoster } from "./parseCsvRoster";

describe("parseCsvRoster", () => {
  it("parses a happy-path CSV with the four required columns", () => {
    const csv = [
      "firstName,lastName,email,role",
      "Jane,Doe,jane@test.test,STAFF",
      "John,Smith,john@test.test,ADMIN",
    ].join("\n");
    const result = parseCsvRoster(csv);
    expect(result.rows).toEqual([
      { firstName: "Jane", lastName: "Doe", email: "jane@test.test", role: "STAFF" },
      { firstName: "John", lastName: "Smith", email: "john@test.test", role: "ADMIN" },
    ]);
    expect(result.defaultedToStaff).toBe(false);
  });

  it("defaults role to STAFF when the column is missing", () => {
    const csv = [
      "firstName,lastName,email",
      "Jane,Doe,jane@test.test",
    ].join("\n");
    const result = parseCsvRoster(csv);
    expect(result.rows[0]!.role).toBe("STAFF");
    expect(result.defaultedToStaff).toBe(true);
  });

  it("is case-insensitive on header names", () => {
    const csv = "FirstName,LASTNAME,Email,Role\nJane,Doe,jane@test.test,VIEWER";
    const result = parseCsvRoster(csv);
    expect(result.rows[0]).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@test.test",
      role: "VIEWER",
    });
  });

  it("ignores unknown columns", () => {
    const csv = "firstName,lastName,email,role,department\nJane,Doe,jane@test.test,STAFF,Front";
    const result = parseCsvRoster(csv);
    expect(result.rows[0]).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@test.test",
      role: "STAFF",
    });
  });

  it("rejects non-OWNER roles only (bulk cannot create owners)", () => {
    const csv = "firstName,lastName,email,role\nJane,Doe,jane@test.test,OWNER";
    const result = parseCsvRoster(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toMatch(/OWNER.*not allowed/i);
  });

  it("normalizes emails to lowercase", () => {
    const csv = "firstName,lastName,email,role\nJane,Doe,JANE@TEST.TEST,STAFF";
    const result = parseCsvRoster(csv);
    expect(result.rows[0]!.email).toBe("jane@test.test");
  });
});
