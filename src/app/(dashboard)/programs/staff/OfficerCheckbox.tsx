// src/app/(dashboard)/programs/staff/OfficerCheckbox.tsx
"use client";

import { useState, useTransition } from "react";
import type { OfficerRole } from "@/lib/events/registry";
import { toggleOfficerAction } from "./actions";
import { cn } from "@/lib/utils";

export interface OfficerCheckboxProps {
  practiceUserId: string;
  officerRole: OfficerRole;
  initialChecked: boolean;
  label: string;
  disabled?: boolean;
}

/**
 * Thin client wrapper around a controlled checkbox + the toggleOfficerAction
 * server action, using useTransition for optimistic feedback. Reverts the
 * visual state if the server action throws.
 */
export function OfficerCheckbox({
  practiceUserId,
  officerRole,
  initialChecked,
  label,
  disabled,
}: OfficerCheckboxProps) {
  const [checked, setChecked] = useState(initialChecked);
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    const prev = checked;
    setChecked(next);
    startTransition(async () => {
      try {
        await toggleOfficerAction({
          practiceUserId,
          officerRole,
          designated: next,
        });
      } catch (err) {
        setChecked(prev);
        console.error("toggleOfficerAction failed", err);
      }
    });
  };

  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
        checked
          ? "border-[color:var(--gw-color-compliant)] bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_10%,transparent)] text-[color:var(--gw-color-compliant)]"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
        (disabled || isPending) && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || isPending}
        onChange={(e) => handleChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--gw-color-compliant)]"
        aria-label={`${label} officer`}
      />
      <span>{label}</span>
    </label>
  );
}
