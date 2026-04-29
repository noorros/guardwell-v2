// src/components/gw/EhrCombobox/index.tsx
//
// Single-select combobox with a free-text "Other" fallback for the EHR
// system used by the practice. Internal helper for PracticeProfileForm.
"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const KNOWN_EHRS = [
  "Epic",
  "Cerner (Oracle Health)",
  "Athenahealth",
  "eClinicalWorks",
  "NextGen",
  "AdvancedMD",
  "DrChrono",
  "Practice Fusion",
  "Greenway",
  "Allscripts",
  "Kareo",
  "ChartLogic",
  "Other",
] as const;

export interface EhrComboboxProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
}

export function EhrCombobox({
  value,
  onChange,
  className,
  disabled,
}: EhrComboboxProps) {
  const [open, setOpen] = useState(false);
  const isKnown = (KNOWN_EHRS as readonly string[]).includes(value);
  const showOtherInput = value === "Other" || (value !== "" && !isKnown);

  // Local draft for the free-text "Other" input. We treat the input as
  // an uncontrolled-ish field once the user starts typing: the parent's
  // `value` prop is treated as the seed and seal-of-record, but
  // intermediate keystrokes live in `otherDraft` so typing remains
  // smooth even if the parent doesn't synchronously re-render on every
  // change. The render-time prop-sync below only kicks in when `value`
  // arrives from outside (e.g. user picks a different EHR from the
  // dropdown), not when the prop just echoes our last onChange.
  const [otherDraft, setOtherDraft] = useState<string>(
    value !== "" && !isKnown ? value : "",
  );
  const [lastSyncedValue, setLastSyncedValue] = useState<string>(value);
  // Render-time sync: only fires when the prop changes to something we
  // haven't already mirrored locally (e.g. dropdown selection from
  // outside). Per the React docs, "adjusting state during render" with
  // a guard is a valid alternative to a useEffect+setState pair and
  // doesn't cascade re-renders.
  if (
    value !== lastSyncedValue &&
    value !== otherDraft &&
    !(value === "Other" && otherDraft !== "")
  ) {
    setLastSyncedValue(value);
    if (value === "Other") {
      setOtherDraft("");
    } else if (value !== "" && !isKnown) {
      setOtherDraft(value);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={value ? `EHR: ${value}` : "Select EHR"}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {value ? value : <span className="text-muted-foreground">Select EHR…</span>}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search EHRs…" />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {KNOWN_EHRS.map((ehr) => (
                  <CommandItem
                    key={ehr}
                    value={ehr}
                    onSelect={() => {
                      onChange(ehr);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === ehr ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                    {ehr}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {showOtherInput && (
        <input
          type="text"
          placeholder="Your EHR…"
          value={otherDraft}
          onChange={(e) => {
            const next = e.target.value;
            setOtherDraft(next);
            setLastSyncedValue(next);
            onChange(next);
          }}
          className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      )}
    </div>
  );
}
