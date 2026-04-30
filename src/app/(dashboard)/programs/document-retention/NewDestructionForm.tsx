// src/app/(dashboard)/programs/document-retention/NewDestructionForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { recordDestructionAction } from "./actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

const DOC_TYPES = [
  { v: "MEDICAL_RECORDS", l: "Medical records" },
  { v: "BILLING", l: "Billing records" },
  { v: "HR", l: "HR records" },
  { v: "EMAIL_BACKUPS", l: "Email / system backups" },
  { v: "OTHER", l: "Other" },
] as const;

const METHODS = [
  { v: "SHREDDING", l: "Shredding" },
  { v: "SECURE_WIPE", l: "Secure wipe" },
  { v: "DEIDENTIFICATION", l: "Deidentification" },
  { v: "INCINERATION", l: "Incineration" },
  { v: "OTHER", l: "Other" },
] as const;

export function NewDestructionForm() {
  const router = useRouter();
  const tz = usePracticeTimezone();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const todayIso = formatPracticeDate(new Date(), tz);
  const [docType, setDocType] = useState<typeof DOC_TYPES[number]["v"]>(
    "MEDICAL_RECORDS",
  );
  const [description, setDescription] = useState("");
  const [volumeEstimate, setVolumeEstimate] = useState("");
  const [method, setMethod] = useState<typeof METHODS[number]["v"]>(
    "SHREDDING",
  );
  const [destroyedAt, setDestroyedAt] = useState(todayIso);
  const [certificateUrl, setCertificateUrl] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    startTransition(async () => {
      try {
        await recordDestructionAction({
          documentType: docType,
          description: description.trim(),
          volumeEstimate: volumeEstimate.trim() || undefined,
          method,
          destroyedAt,
          certificateUrl: certificateUrl.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        setDescription("");
        setVolumeEstimate("");
        setCertificateUrl("");
        setNotes("");
        setNotice("Logged. The HIPAA documentation-retention requirement updates on the next /modules/hipaa view.");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to log destruction.");
      }
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Log a destruction event</h2>
        <p className="text-xs text-muted-foreground">
          Each event is your audit record that the destruction actually
          happened. Attach a vendor certificate URL when applicable.
        </p>
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="destruction-doc-type" className="block text-xs font-medium text-foreground">
                Document type
              </label>
              <select
                id="destruction-doc-type"
                value={docType}
                onChange={(e) =>
                  setDocType(e.target.value as typeof DOC_TYPES[number]["v"])
                }
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="destruction-method" className="block text-xs font-medium text-foreground">
                Method
              </label>
              <select
                id="destruction-method"
                value={method}
                onChange={(e) =>
                  setMethod(e.target.value as typeof METHODS[number]["v"])
                }
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {METHODS.map((m) => (
                  <option key={m.v} value={m.v}>
                    {m.l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="destruction-description" className="block text-xs font-medium text-foreground">
              Description (scope, date range, patient cohort, etc.)
            </label>
            <textarea
              id="destruction-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              required
              placeholder="e.g. Closed paper charts for patients last seen in 2018 (n=47)"
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="destruction-volume" className="block text-xs font-medium text-foreground">
                Volume estimate
              </label>
              <input
                id="destruction-volume"
                type="text"
                value={volumeEstimate}
                onChange={(e) => setVolumeEstimate(e.target.value)}
                placeholder="e.g. 12 boxes"
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="destruction-date" className="block text-xs font-medium text-foreground">
                Destruction date
              </label>
              <input
                id="destruction-date"
                type="date"
                value={destroyedAt}
                onChange={(e) => setDestroyedAt(e.target.value)}
                required
                max={todayIso}
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="destruction-certificate-url" className="block text-xs font-medium text-foreground">
              Certificate of destruction URL (optional)
            </label>
            <input
              id="destruction-certificate-url"
              type="url"
              value={certificateUrl}
              onChange={(e) => setCertificateUrl(e.target.value)}
              placeholder="https://"
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="destruction-notes" className="block text-xs font-medium text-foreground">
              Notes (optional)
            </label>
            <textarea
              id="destruction-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
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
              {isPending ? "Logging…" : "Log destruction"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
