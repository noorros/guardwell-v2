// src/app/(dashboard)/programs/security-assets/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { Server, ShieldAlert, FileUp, FileDown } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/gw/EmptyState";
import { CITATIONS } from "@/lib/regulations/citations";
import { AssetForm } from "./AssetForm";
import { RetireAssetButton } from "./RetireAssetButton";

export const metadata = { title: "Security assets · My Programs" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  SERVER: "Server",
  LAPTOP: "Laptop",
  DESKTOP: "Desktop",
  MOBILE: "Mobile",
  EMR: "EMR / EHR",
  NETWORK_DEVICE: "Network device",
  CLOUD_SERVICE: "Cloud service",
  OTHER: "Other",
};

const ENCRYPTION_LABELS: Record<string, string> = {
  FULL_DISK: "Full-disk",
  FIELD_LEVEL: "Field-level",
  NONE: "None",
  UNKNOWN: "Unknown",
};

export default async function SecurityAssetsPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const assets = await db.techAsset.findMany({
    where: { practiceId: pu.practiceId, retiredAt: null },
    orderBy: [{ processesPhi: "desc" }, { name: "asc" }],
  });

  const phiCount = assets.filter((a) => a.processesPhi).length;
  const unencryptedPhi = assets.filter(
    (a) => a.processesPhi && a.encryption === "NONE",
  );

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "My Programs" }, { label: "Security assets" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Server className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Security assets
          </h1>
          <p className="text-sm text-muted-foreground">
            HIPAA Security Rule {CITATIONS.HIPAA_PHYSICAL_SAFEGUARDS.code} +{" "}
            {CITATIONS.HIPAA_TECHNICAL_SAFEGUARDS.code} — identify the systems
            that store and transmit ePHI. Required for a substantive SRA;
            the HIPAA_SRA requirement on /modules/hipaa won&apos;t flip
            COMPLIANT until ≥1 PHI-processing asset is on file.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total assets
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {assets.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              PHI-processing
            </p>
            <p className="text-2xl font-semibold tabular-nums">{phiCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              PHI w/o encryption
            </p>
            <p
              className="text-2xl font-semibold tabular-nums"
              style={{
                color:
                  unencryptedPhi.length > 0
                    ? "var(--gw-color-risk)"
                    : "var(--gw-color-compliant)",
              }}
            >
              {unencryptedPhi.length}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={"/programs/security-assets/bulk-import" as Route}
          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent"
        >
          <FileUp className="h-3.5 w-3.5" aria-hidden /> Bulk import (CSV)
        </Link>
        {assets.length > 0 && (
          <a
            href="/api/security-assets/export"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden /> Export CSV
          </a>
        )}
      </div>

      <AssetForm />

      {unencryptedPhi.length > 0 && (
        <Card>
          <CardContent className="flex items-start gap-2 p-4">
            <ShieldAlert
              className="h-4 w-4 text-[color:var(--gw-color-risk)]"
              aria-hidden="true"
            />
            <div className="flex-1 space-y-0.5">
              <p className="text-xs font-semibold text-[color:var(--gw-color-risk)]">
                {unencryptedPhi.length} PHI-processing asset
                {unencryptedPhi.length === 1 ? "" : "s"} have no encryption
              </p>
              <p className="text-[11px] text-muted-foreground">
                The HIPAA Security Rule recognizes encryption as an
                addressable safeguard; OCR breach-notification reductions
                generally require it. Document a compensating control in
                Notes if you can&apos;t encrypt.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active assets
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {assets.length} item{assets.length === 1 ? "" : "s"}
            </span>
          </div>
          {assets.length === 0 ? (
            <EmptyState
              icon={Server}
              title="No assets yet"
              description="Use the form above to add the systems that store or transmit ePHI. Most small practices end up with 5-15 assets."
            />
          ) : (
            <ul className="divide-y">
              {assets.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {a.name}
                      </p>
                      <Badge variant="secondary" className="text-[10px]">
                        {TYPE_LABELS[a.assetType] ?? a.assetType}
                      </Badge>
                      {a.processesPhi && (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          style={{
                            color: "var(--gw-color-risk)",
                            borderColor: "var(--gw-color-risk)",
                          }}
                        >
                          PHI
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {ENCRYPTION_LABELS[a.encryption] ?? a.encryption}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {a.vendor && <>Vendor: {a.vendor} · </>}
                      {a.location && <>Location: {a.location}</>}
                    </p>
                  </div>
                  <RetireAssetButton techAssetId={a.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
