// src/app/(dashboard)/audit/prep/StartSessionForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { openAuditPrepSessionAction } from "./actions";

export function StartSessionForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"HHS_OCR_HIPAA" | "OSHA" | "CMS" | "DEA">(
    "HHS_OCR_HIPAA",
  );

  const handleStart = () => {
    setError(null);
    startTransition(async () => {
      try {
        const { auditPrepSessionId } = await openAuditPrepSessionAction({
          mode,
        });
        router.push(`/audit/prep/${auditPrepSessionId}` as Route);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open session.");
      }
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Start a new session</h2>
        <p className="text-xs text-muted-foreground">
          Pick the audit type. HHS OCR HIPAA, OSHA, CMS, and DEA modes
          are all live.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 space-y-1 text-xs font-medium text-foreground">
            Audit type
            <select
              value={mode}
              onChange={(e) =>
                setMode(
                  e.target.value as "HHS_OCR_HIPAA" | "OSHA" | "CMS" | "DEA",
                )
              }
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="HHS_OCR_HIPAA">HHS OCR HIPAA</option>
              <option value="OSHA">OSHA inspection</option>
              <option value="CMS">CMS / Medicare audit</option>
              <option value="DEA">DEA inspection</option>
            </select>
          </label>
          <Button onClick={handleStart} size="sm" disabled={isPending}>
            {isPending ? "Opening…" : "Start session"}
          </Button>
        </div>
        {error && (
          <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
