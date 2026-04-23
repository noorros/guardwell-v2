// src/app/(dashboard)/programs/security-assets/AssetForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { upsertTechAssetAction } from "./actions";

const ASSET_TYPES = [
  { v: "SERVER", l: "Server" },
  { v: "LAPTOP", l: "Laptop" },
  { v: "DESKTOP", l: "Desktop" },
  { v: "MOBILE", l: "Mobile (phone/tablet)" },
  { v: "EMR", l: "EMR / EHR system" },
  { v: "NETWORK_DEVICE", l: "Network device" },
  { v: "CLOUD_SERVICE", l: "Cloud service" },
  { v: "OTHER", l: "Other" },
] as const;

const ENCRYPTION = [
  { v: "FULL_DISK", l: "Full-disk encryption" },
  { v: "FIELD_LEVEL", l: "Field-level encryption" },
  { v: "NONE", l: "None" },
  { v: "UNKNOWN", l: "Unknown" },
] as const;

export function AssetForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<typeof ASSET_TYPES[number]["v"]>("LAPTOP");
  const [processesPhi, setProcessesPhi] = useState(true);
  const [encryption, setEncryption] = useState<typeof ENCRYPTION[number]["v"]>("FULL_DISK");
  const [vendor, setVendor] = useState("");
  const [location, setLocation] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    startTransition(async () => {
      try {
        await upsertTechAssetAction({
          name: name.trim(),
          assetType,
          processesPhi,
          encryption,
          vendor: vendor.trim() || undefined,
          location: location.trim() || undefined,
        });
        setName("");
        setVendor("");
        setLocation("");
        setNotice("Added. SRA on /modules/hipaa updates on next view.");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add asset.");
      }
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Add a technology asset</h2>
        <p className="text-xs text-muted-foreground">
          Required for the SRA: anything that stores or transmits ePHI
          (EHR, laptops, mobile devices, cloud services, etc.).
        </p>
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <label className="block text-xs font-medium text-foreground">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. eClinicalWorks production EHR"
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-foreground">
              Type
              <select
                value={assetType}
                onChange={(e) =>
                  setAssetType(
                    e.target.value as typeof ASSET_TYPES[number]["v"],
                  )
                }
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {ASSET_TYPES.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-foreground">
              Encryption (at rest)
              <select
                value={encryption}
                onChange={(e) =>
                  setEncryption(
                    e.target.value as typeof ENCRYPTION[number]["v"],
                  )
                }
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {ENCRYPTION.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={processesPhi}
              onChange={(e) => setProcessesPhi(e.target.checked)}
            />
            <span>Stores or transmits ePHI</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-foreground">
              Vendor
              <input
                type="text"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="e.g. Apple, Dell, Athena"
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-foreground">
              Location
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Front desk, US-east-1"
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          {error && (
            <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
          )}
          {notice && (
            <p className="text-xs text-[color:var(--gw-color-compliant)]">
              {notice}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Adding…" : "Add asset"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
