// src/app/(dashboard)/programs/allergy/CompetencyTab/RequiredToggle.tsx
//
// Per-member "requires allergy competency" toggle. Extracted from
// CompetencyTab.tsx (audit #21 MIN-8, Wave-4 D4).

"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { toggleStaffAllergyRequirementAction } from "../actions";

export interface RequiredToggleProps {
  practiceUserId: string;
  initialRequired: boolean;
}

export function RequiredToggle({ practiceUserId, initialRequired }: RequiredToggleProps) {
  const [required, setRequired] = useState(initialRequired);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    const prev = required;
    setRequired(next);
    startTransition(async () => {
      try {
        await toggleStaffAllergyRequirementAction({ practiceUserId, required: next });
      } catch {
        setRequired(prev);
      }
    });
  }

  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
        required
          ? "border-[color:var(--gw-color-compliant)] bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_10%,transparent)] text-[color:var(--gw-color-compliant)]"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
        isPending && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={required}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--gw-color-compliant)]"
        aria-label="Requires allergy competency"
      />
      <span>{required ? "Required" : "Not required"}</span>
    </label>
  );
}
