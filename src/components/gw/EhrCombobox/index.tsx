// src/components/gw/EhrCombobox/index.tsx
//
// Single-select combobox with a free-text "Other" fallback for the EHR
// system used by the practice. Internal helper for PracticeProfileForm.
"use client";

import { useEffect, useRef, useState } from "react";
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
  // Local draft for the free-text input so the user can type smoothly
  // even when the parent doesn't synchronously re-render on every keystroke.
  const [otherDraft, setOtherDraft] = useState<string>(
    value !== "" && !isKnown ? value : "",
  );
  const lastSyncedValue = useRef<string>(value);
  useEffect(() => {
    if (value !== lastSyncedValue.current) {
      lastSyncedValue.current = value;
      if (value !== "Other" && !isKnown) {
        setOtherDraft(value);
      } else if (value === "Other") {
        setOtherDraft("");
      }
    }
  }, [value, isKnown]);

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
            lastSyncedValue.current = next;
            onChange(next);
          }}
          className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      )}
    </div>
  );
}
