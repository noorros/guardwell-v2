// src/app/(dashboard)/programs/credentials/bulk-import/CredentialBulkImport.tsx
"use client";

import { BulkCsvImport } from "@/components/gw/BulkCsvImport";
import {
  bulkImportCredentialsAction,
  type BulkCredentialImportRow,
} from "../actions";

const TEMPLATE_CSV = `credentialTypeCode,holderEmail,title,licenseNumber,issuingBody,issueDate,expiryDate,notes
MD_STATE_LICENSE,jane@example.com,Jane Smith · AZ MD License,12345,Arizona Medical Board,2020-06-15,2026-06-30,
DEA_REGISTRATION,jane@example.com,Jane Smith · DEA Schedule II-V,AB1234567,DEA,2024-01-01,2027-01-01,
MALPRACTICE_INSURANCE,,Practice malpractice policy,POL-2025-001,Coverys,2025-01-01,2026-01-01,Full coverage
`;

function parseDateOrISO(s: string): string | null | undefined {
  const t = s.trim();
  if (!t) return undefined;
  // Accept YYYY-MM-DD or full ISO.
  const d = new Date(t.length === 10 ? `${t}T12:00:00.000Z` : t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function CredentialBulkImport() {
  return (
    <BulkCsvImport<BulkCredentialImportRow>
      hint="Each row becomes one active credential. Required: credentialTypeCode, title."
      templateCsv={TEMPLATE_CSV}
      templateFilename="credentials-template"
      parseConfig={{
        columns: [
          {
            field: "credentialTypeCode",
            label: "credentialTypeCode",
            required: true,
            aliases: ["type code", "credential type"],
          },
          {
            field: "holderEmail",
            label: "holderEmail",
            aliases: ["holder", "email", "owner email"],
          },
          { field: "title", label: "title", required: true },
          {
            field: "licenseNumber",
            label: "licenseNumber",
            aliases: ["license number", "license #", "registration #"],
          },
          {
            field: "issuingBody",
            label: "issuingBody",
            aliases: ["issuer", "issuing body"],
          },
          {
            field: "issueDate",
            label: "issueDate",
            aliases: ["issued", "issue date"],
          },
          {
            field: "expiryDate",
            label: "expiryDate",
            aliases: ["expires", "expiration", "expiry date"],
          },
          { field: "notes", label: "notes" },
        ],
        parseRow: (raw) => {
          const code = (raw.credentialTypeCode ?? "").trim();
          if (!code) return { ok: false, error: "credentialTypeCode is required" };
          const title = (raw.title ?? "").trim();
          if (!title) return { ok: false, error: "title is required" };

          const issued = parseDateOrISO(raw.issueDate ?? "");
          if (issued === null)
            return {
              ok: false,
              error: `issueDate could not be parsed (got "${raw.issueDate}")`,
            };
          const expires = parseDateOrISO(raw.expiryDate ?? "");
          if (expires === null)
            return {
              ok: false,
              error: `expiryDate could not be parsed (got "${raw.expiryDate}")`,
            };

          return {
            ok: true,
            row: {
              credentialTypeCode: code,
              holderEmail: raw.holderEmail?.trim() || null,
              title,
              licenseNumber: raw.licenseNumber?.trim() || null,
              issuingBody: raw.issuingBody?.trim() || null,
              issueDate: issued ?? null,
              expiryDate: expires ?? null,
              notes: raw.notes?.trim() || null,
            },
          };
        },
      }}
      renderRow={(r) => (
        <span className="font-mono text-[11px]">
          {r.title}
          {r.licenseNumber ? ` · ${r.licenseNumber}` : ""}
          {r.holderEmail ? ` · ${r.holderEmail}` : " · practice-level"}
          {r.expiryDate ? ` · expires ${r.expiryDate.slice(0, 10)}` : ""}
        </span>
      )}
      onSubmit={async (rows) => bulkImportCredentialsAction({ rows })}
    />
  );
}
