"use client";

import { Info } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

export type AiReasonSource =
  | "USER"
  | "AI_ASSESSMENT"
  | "IMPORT"
  | "DERIVED"
  | null;

export interface AiReasonIndicatorProps {
  source: AiReasonSource | undefined;
  reason: string | null | undefined;
}

/**
 * Tiny Info icon button that opens a popover explaining Claude's reasoning.
 * Renders nothing when the latest status update came from a human or an
 * import — only AI assessments with a non-empty reason get the indicator.
 */
export function AiReasonIndicator({ source, reason }: AiReasonIndicatorProps) {
  if (source !== "AI_ASSESSMENT") return null;
  const trimmed = reason?.trim();
  if (!trimmed) return null;

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Why Claude suggested this"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <p className="mb-1 text-xs font-semibold text-foreground">
          Claude&apos;s reasoning
        </p>
        <p className="text-xs text-muted-foreground">{trimmed}</p>
      </PopoverContent>
    </Popover>
  );
}
