// src/app/(dashboard)/programs/vendors/bulk-import/VendorBulkImport.tsx
"use client";

import { BulkCsvImport } from "@/components/gw/BulkCsvImport";
import {
  bulkImportVendorsAction,
  type BulkVendorImportRow,
} from "../actions";

const TEMPLATE_CSV = `name,type,service,contact,email,processesPhi,baaExecutedAt,baaExpiresAt,baaDirection,notes
eClinicalWorks,EHR,Electronic medical record,Sales rep,sales@ecw.example,true,2025-01-01,2027-01-01,VENDOR_PROVIDED,Primary EHR
Athenahealth,Billing,Practice management + billing,,support@athena.example,true,2024-08-15,,VENDOR_PROVIDED,
ShredCo,Other,Document destruction,Annie Smith,annie@shredco.example,false,,,,Quarterly pickup
Microsoft 365,Cloud,Email + file storage,,,true,2023-05-01,,PRACTICE_PROVIDED,
`;

const BAA_DIRECTIONS = [
  "PRACTICE_PROVIDED",
  "VENDOR_PROVIDED",
  "PLATFORM_ACKNOWLEDGMENT",
] as const;

function parseBool(s: string): boolean | null {
  const t = s.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(t)) return true;
  if (["false", "no", "n", "0", ""].includes(t)) return false;
  return null;
}

function parseDate(s: string): string | null | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function VendorBulkImport() {
  return (
    <BulkCsvImport<BulkVendorImportRow>
      hint="Each row becomes one active Vendor. Required: name, processesPhi. BAA fields are optional."
      templateCsv={TEMPLATE_CSV}
      templateFilename="vendors-template"
      parseConfig={{
        columns: [
          { field: "name", label: "name", required: true },
          { field: "type", label: "type" },
          { field: "service", label: "service" },
          { field: "contact", label: "contact" },
          { field: "email", label: "email" },
          {
            field: "processesPhi",
            label: "processesPhi",
            required: true,
            aliases: ["processes phi", "phi", "has phi"],
          },
          {
            field: "baaExecutedAt",
            label: "baaExecutedAt",
            aliases: ["baa executed", "baa date"],
          },
          {
            field: "baaExpiresAt",
            label: "baaExpiresAt",
            aliases: ["baa expires", "baa expiration"],
          },
          {
            field: "baaDirection",
            label: "baaDirection",
            aliases: ["baa direction"],
          },
          { field: "notes", label: "notes" },
        ],
        parseRow: (raw) => {
          const name = (raw.name ?? "").trim();
          if (!name) return { ok: false, error: "name is required" };

          const phi = parseBool(raw.processesPhi ?? "");
          if (phi === null)
            return {
              ok: false,
              error: `processesPhi must be true/false (got "${raw.processesPhi}")`,
            };

          const executedAt = parseDate(raw.baaExecutedAt ?? "");
          if (executedAt === null)
            return {
              ok: false,
              error: `baaExecutedAt could not be parsed as a date (got "${raw.baaExecutedAt}")`,
            };
          const expiresAt = parseDate(raw.baaExpiresAt ?? "");
          if (expiresAt === null)
            return {
              ok: false,
              error: `baaExpiresAt could not be parsed as a date (got "${raw.baaExpiresAt}")`,
            };

          const baaDirection = (raw.baaDirection ?? "").trim().toUpperCase();
          let direction: BulkVendorImportRow["baaDirection"] = null;
          if (baaDirection) {
            if (
              !BAA_DIRECTIONS.includes(
                baaDirection as (typeof BAA_DIRECTIONS)[number],
              )
            ) {
              return {
                ok: false,
                error: `baaDirection must be one of ${BAA_DIRECTIONS.join(" / ")}`,
              };
            }
            direction = baaDirection as BulkVendorImportRow["baaDirection"];
          }

          return {
            ok: true,
            row: {
              name,
              type: raw.type?.trim() || null,
              service: raw.service?.trim() || null,
              contact: raw.contact?.trim() || null,
              email: raw.email?.trim() || null,
              notes: raw.notes?.trim() || null,
              processesPhi: phi,
              baaExecutedAt: executedAt ?? null,
              baaExpiresAt: expiresAt ?? null,
              baaDirection: direction,
            },
          };
        },
      }}
      renderRow={(r) => (
        <span className="font-mono text-[11px]">
          {r.name}
          {r.type ? ` · ${r.type}` : ""} ·{" "}
          {r.processesPhi ? "PHI" : "no PHI"}
          {r.baaExecutedAt
            ? ` · BAA ${r.baaExecutedAt.slice(0, 10)}`
            : " · no BAA"}
        </span>
      )}
      onSubmit={async (rows) => bulkImportVendorsAction({ rows })}
    />
  );
}
