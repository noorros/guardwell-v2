import { parse } from "csv-parse/sync";

export type RosterRole = "ADMIN" | "STAFF" | "VIEWER";

export interface RosterRow {
  firstName: string;
  lastName: string;
  email: string;
  role: RosterRole;
}

export interface ParseResult {
  rows: RosterRow[];
  errors: string[];
  defaultedToStaff: boolean;
}

const REQUIRED_COLUMNS = ["firstName", "lastName", "email"] as const;
const VALID_ROLES: RosterRole[] = ["ADMIN", "STAFF", "VIEWER"];

function canonicalize(raw: string): string {
  return raw.trim().replace(/["']/g, "").toLowerCase();
}

const HEADER_ALIASES: Record<string, string> = {
  firstname: "firstName",
  "first name": "firstName",
  first: "firstName",
  lastname: "lastName",
  "last name": "lastName",
  last: "lastName",
  email: "email",
  "email address": "email",
  role: "role",
};

export function parseCsvRoster(csvText: string): ParseResult {
  const errors: string[] = [];
  let records: Record<string, string>[];
  try {
    records = parse(csvText, {
      columns: (headers: string[]) =>
        headers.map((h) => HEADER_ALIASES[canonicalize(h)] ?? canonicalize(h)),
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (err) {
    return {
      rows: [],
      errors: [err instanceof Error ? err.message : "CSV parse failed"],
      defaultedToStaff: false,
    };
  }

  if (records.length === 0) {
    return { rows: [], errors: ["CSV has no data rows"], defaultedToStaff: false };
  }

  // records.length > 0 is guaranteed by the early-return above; non-null assertion
  // is needed because tsc doesn't narrow through the early-return guard.
  const firstRow = records[0]!;
  for (const col of REQUIRED_COLUMNS) {
    if (!(col in firstRow)) {
      errors.push(`Missing required column: ${col}`);
    }
  }
  if (errors.length) {
    return { rows: [], errors, defaultedToStaff: false };
  }

  const defaultedToStaff = !("role" in firstRow);
  const rows: RosterRow[] = [];
  records.forEach((rec, idx) => {
    const line = idx + 2; // header is line 1
    const rawRole = (rec.role ?? "STAFF").toUpperCase();
    if (!VALID_ROLES.includes(rawRole as RosterRole)) {
      if (rawRole === "OWNER") {
        errors.push(`Line ${line}: role OWNER is not allowed in bulk invite`);
      } else {
        errors.push(`Line ${line}: unknown role "${rec.role}"`);
      }
      return;
    }
    const email = (rec.email ?? "").trim().toLowerCase();
    if (!email) {
      errors.push(`Line ${line}: email is required`);
      return;
    }
    rows.push({
      firstName: (rec.firstName ?? "").trim(),
      lastName: (rec.lastName ?? "").trim(),
      email,
      role: rawRole as RosterRole,
    });
  });
  return { rows, errors, defaultedToStaff };
}
