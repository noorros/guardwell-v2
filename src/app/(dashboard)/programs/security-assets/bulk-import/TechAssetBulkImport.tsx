// src/app/(dashboard)/programs/security-assets/bulk-import/TechAssetBulkImport.tsx
//
// Client wrapper that wires <BulkCsvImport> to bulkImportTechAssetsAction
// with tech-asset-specific column config + per-row parser. Same pattern
// will be reused for vendors + credentials in follow-up PRs.

"use client";

import { BulkCsvImport } from "@/components/gw/BulkCsvImport";
import {
  bulkImportTechAssetsAction,
  type BulkTechAssetRow,
} from "../actions";

const ASSET_TYPES = [
  "SERVER",
  "LAPTOP",
  "DESKTOP",
  "MOBILE",
  "EMR",
  "NETWORK_DEVICE",
  "CLOUD_SERVICE",
  "OTHER",
] as const;

const ENCRYPTION_VALUES = [
  "FULL_DISK",
  "FIELD_LEVEL",
  "NONE",
  "UNKNOWN",
] as const;

const TEMPLATE_CSV = `name,assetType,processesPhi,encryption,vendor,location,notes
Front desk PC,DESKTOP,true,FULL_DISK,Dell,Front office,Used for check-in only
Provider laptop 1,LAPTOP,true,FULL_DISK,Apple,Mobile,
EMR,CLOUD_SERVICE,true,FIELD_LEVEL,Athenahealth,Cloud,Primary EHR
Wi-Fi access point,NETWORK_DEVICE,false,UNKNOWN,Ubiquiti,Server room,
`;

function parseBool(s: string): boolean | null {
  const t = s.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(t)) return true;
  if (["false", "no", "n", "0", ""].includes(t)) return false;
  return null;
}

export function TechAssetBulkImport() {
  return (
    <BulkCsvImport<BulkTechAssetRow>
      hint="Each row becomes one active TechAsset. Required columns: name, assetType, processesPhi, encryption."
      templateCsv={TEMPLATE_CSV}
      templateFilename="security-assets-template"
      parseConfig={{
        columns: [
          { field: "name", label: "name", required: true },
          {
            field: "assetType",
            label: "assetType",
            required: true,
            aliases: ["asset type", "type"],
          },
          {
            field: "processesPhi",
            label: "processesPhi",
            required: true,
            aliases: ["processes phi", "phi", "has phi"],
          },
          {
            field: "encryption",
            label: "encryption",
            required: true,
          },
          { field: "vendor", label: "vendor" },
          {
            field: "location",
            label: "location",
            aliases: ["site"],
          },
          { field: "notes", label: "notes" },
        ],
        parseRow: (raw, line) => {
          const name = (raw.name ?? "").trim();
          if (!name) return { ok: false, error: "name is required" };

          const assetType = (raw.assetType ?? "").trim().toUpperCase();
          if (!ASSET_TYPES.includes(assetType as (typeof ASSET_TYPES)[number])) {
            return {
              ok: false,
              error: `unknown assetType "${raw.assetType}" — must be one of ${ASSET_TYPES.join(" / ")}`,
            };
          }

          const phi = parseBool(raw.processesPhi ?? "");
          if (phi === null) {
            return {
              ok: false,
              error: `processesPhi must be true/false (got "${raw.processesPhi}")`,
            };
          }

          const encryption = (raw.encryption ?? "").trim().toUpperCase();
          if (
            !ENCRYPTION_VALUES.includes(
              encryption as (typeof ENCRYPTION_VALUES)[number],
            )
          ) {
            return {
              ok: false,
              error: `unknown encryption "${raw.encryption}" — must be one of ${ENCRYPTION_VALUES.join(" / ")}`,
            };
          }

          // PHI without encryption is a real flag, not a hard error — let
          // the user import then surface the gap downstream. We only fail
          // on actual unparseable input here.
          void line;
          return {
            ok: true,
            row: {
              name,
              assetType: assetType as BulkTechAssetRow["assetType"],
              processesPhi: phi,
              encryption: encryption as BulkTechAssetRow["encryption"],
              vendor: raw.vendor?.trim() || null,
              location: raw.location?.trim() || null,
              notes: raw.notes?.trim() || null,
            },
          };
        },
      }}
      renderRow={(r) => (
        <span className="font-mono text-[11px]">
          {r.name} · {r.assetType} ·{" "}
          {r.processesPhi ? "PHI" : "no PHI"} · {r.encryption}
          {r.vendor ? ` · ${r.vendor}` : ""}
        </span>
      )}
      onSubmit={async (rows) => bulkImportTechAssetsAction({ rows })}
    />
  );
}
