// src/app/(dashboard)/programs/cybersecurity/PhishingDrillForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { logPhishingDrillAction } from "./actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

export function PhishingDrillForm() {
  const router = useRouter();
  const tz = usePracticeTimezone();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [conductedAt, setConductedAt] = useState(
    () => formatPracticeDate(new Date(), tz),
  );
  const [vendor, setVendor] = useState("");
  const [totalRecipients, setTotalRecipients] = useState("");
  const [clickedCount, setClickedCount] = useState("");
  const [reportedCount, setReportedCount] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = () => {
    setError(null);
    const total = Number.parseInt(totalRecipients, 10);
    const clicked = Number.parseInt(clickedCount, 10);
    const reported = Number.parseInt(reportedCount, 10);
    if (!Number.isFinite(total) || total < 1) {
      setError("Total recipients must be ≥ 1.");
      return;
    }
    if (!Number.isFinite(clicked) || clicked < 0 || clicked > total) {
      setError(`Clicked must be 0–${total}.`);
      return;
    }
    if (!Number.isFinite(reported) || reported < 0 || reported > total) {
      setError(`Reported must be 0–${total}.`);
      return;
    }
    startTransition(async () => {
      try {
        await logPhishingDrillAction({
          conductedAtIso: new Date(conductedAt).toISOString(),
          vendor: vendor.trim() || undefined,
          totalRecipients: total,
          clickedCount: clicked,
          reportedCount: reported,
          notes: notes.trim() || undefined,
        });
        setOpen(false);
        setVendor("");
        setTotalRecipients("");
        setClickedCount("");
        setReportedCount("");
        setNotes("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to log drill");
      }
    });
  };

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Log a phishing drill
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">New phishing drill</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium text-foreground">
            Conducted at
            <input
              type="date"
              value={conductedAt}
              onChange={(e) => setConductedAt(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-foreground">
            Vendor (optional)
            <input
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="KnowBe4, Hoxhunt, Microsoft, Internal…"
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-foreground">
            Total recipients
            <input
              type="number"
              min={1}
              value={totalRecipients}
              onChange={(e) => setTotalRecipients(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-foreground">
            Clicked
            <input
              type="number"
              min={0}
              value={clickedCount}
              onChange={(e) => setClickedCount(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-foreground">
            Reported
            <input
              type="number"
              min={0}
              value={reportedCount}
              onChange={(e) => setReportedCount(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
        </div>
        <label className="block space-y-1 text-xs font-medium text-foreground">
          Notes (optional)
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Template used, follow-up training assigned, repeat clickers, etc."
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        {error && (
          <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
        )}
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Logging…" : "Log drill"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
