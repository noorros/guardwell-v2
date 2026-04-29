// src/components/gw/SpecialtyCombobox/index.tsx
//
// Single-select combobox for the curated specialty list. Backed by cmdk +
// Popover (the standard Shadcn searchable-combobox recipe). Used in
// onboarding compliance-profile and the settings practice profile form.
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
import { SPECIALTIES } from "@/lib/specialties";

export interface SpecialtyComboboxProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
}

export function SpecialtyCombobox({
  value,
  onChange,
  className,
  disabled,
}: SpecialtyComboboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={value ? `Specialty: ${value}` : "Select specialty"}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          {value ? value : <span className="text-muted-foreground">Select specialty…</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search specialties…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {SPECIALTIES.map((s) => (
                <CommandItem
                  key={s.value}
                  value={s.value}
                  onSelect={() => {
                    onChange(s.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === s.value ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  {s.value}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
