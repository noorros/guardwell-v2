// src/app/(dashboard)/audit/prep/[id]/StepPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { completeStepAction, reopenStepAction } from "../actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

export interface StepPanelProps {
  sessionId: string;
  stepCode: string;
  title: string;
  citation: string;
  description: string;
  whatWeAttach: string[];
  status: "PENDING" | "COMPLETE" | "NOT_APPLICABLE";
  notes: string | null;
  completedAtIso: string | null;
}

export function StepPanel({
  sessionId,
  stepCode,
  title,
  citation,
  description,
  whatWeAttach,
  status,
  notes: initialNotes,
  completedAtIso,
}: StepPanelProps) {
  const router = useRouter();
  const tz = usePracticeTimezone();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(initialNotes ?? "");

  const handleComplete = (newStatus: "COMPLETE" | "NOT_APPLICABLE") => {
    setError(null);
    startTransition(async () => {
      try {
        await completeStepAction({
          auditPrepSessionId: sessionId,
          stepCode,
          status: newStatus,
          notes: notes.trim() || undefined,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  const handleReopen = () => {
    setError(null);
    startTransition(async () => {
      try {
        await reopenStepAction({
          auditPrepSessionId: sessionId,
          stepCode,
        });
        setNotes("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  const isDone = status !== "PENDING";

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{title}</h3>
              <Badge variant="outline" className="text-[10px]">
                {citation}
              </Badge>
              {isDone && (
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={{
                    color:
                      status === "COMPLETE"
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-setup)",
                    borderColor:
                      status === "COMPLETE"
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-setup)",
                  }}
                >
                  {status === "COMPLETE" ? "Complete" : "N/A"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-[11px]">
          <p className="font-medium text-foreground">
            What we&apos;ll attach to the packet
          </p>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {whatWeAttach.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        {!isDone ? (
          <>
            <label className="block text-[11px] font-medium text-foreground">
              Notes (optional, included in packet)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-xs"
              />
            </label>
            {error && (
              <p className="text-[11px] text-[color:var(--gw-color-risk)]">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleComplete("NOT_APPLICABLE")}
                disabled={isPending}
              >
                Mark N/A
              </Button>
              <Button
                size="sm"
                onClick={() => handleComplete("COMPLETE")}
                disabled={isPending}
              >
                {isPending ? "Saving…" : "Mark complete"}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-end justify-between gap-3 text-[11px] text-muted-foreground">
            <div>
              {completedAtIso && (
                <p>
                  Completed{" "}
                  {formatPracticeDate(new Date(completedAtIso), tz)}
                </p>
              )}
              {notes && (
                <p className="mt-1">
                  <span className="font-medium text-foreground">Notes:</span>{" "}
                  {notes}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleReopen}
              disabled={isPending}
              className="text-[10px]"
            >
              Reopen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
