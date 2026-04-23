// src/app/(dashboard)/programs/track/TrackTaskRow.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import {
  recordTrackTaskCompletionAction,
  reopenTrackTaskAction,
} from "./actions";

export interface TrackTaskRowProps {
  taskId: string;
  title: string;
  description: string;
  href: string;
  requirementCode: string | null;
  completedAt: string | null;
}

export function TrackTaskRow({
  taskId,
  title,
  description,
  href,
  requirementCode,
  completedAt,
}: TrackTaskRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const handle = (mode: "complete" | "reopen") => {
    setError(null);
    startTransition(async () => {
      try {
        if (mode === "complete") {
          await recordTrackTaskCompletionAction({ trackTaskId: taskId });
        } else {
          await reopenTrackTaskAction({ trackTaskId: taskId });
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };
  const done = completedAt !== null;
  return (
    <li
      className={`flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between ${
        done ? "bg-muted/30" : ""
      }`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {done && (
            <Check
              className="h-3.5 w-3.5 text-[color:var(--gw-color-compliant)]"
              aria-label="Completed"
            />
          )}
          <p
            className={`text-sm font-medium ${
              done ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          >
            {title}
          </p>
          {requirementCode && (
            <Badge variant="outline" className="text-[9px]">
              auto-completes
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{description}</p>
        {error && (
          <p className="text-[10px] text-[color:var(--gw-color-risk)]">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <Button asChild size="sm" variant="outline">
          <Link href={href as Route}>Open</Link>
        </Button>
        {done ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => handle("reopen")}
            disabled={isPending}
            className="text-[10px]"
          >
            Reopen
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => handle("complete")}
            disabled={isPending}
            className="text-[10px]"
          >
            Mark done
          </Button>
        )}
      </div>
    </li>
  );
}
