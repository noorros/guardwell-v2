// src/app/(dashboard)/programs/track/SyncButton.tsx
"use client";

import { useState, useTransition } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncTrackFromEvidenceAction } from "./actions";

export function SyncButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onClick() {
    startTransition(async () => {
      try {
        const { closed } = await syncTrackFromEvidenceAction();
        setMessage(
          closed === 0
            ? "Already up to date"
            : `Closed ${closed} task${closed === 1 ? "" : "s"}`,
        );
      } catch (err) {
        setMessage("Sync failed — try again");
        // Surface for log inspection without leaking PII.
        console.error("[track-sync]", err);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={pending}
        aria-label="Sync track from current compliance state"
      >
        <RefreshCcw
          className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        <span className="ml-1.5">{pending ? "Syncing…" : "Sync"}</span>
      </Button>
      {message && (
        <span className="text-xs text-muted-foreground" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
