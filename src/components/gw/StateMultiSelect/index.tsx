// src/components/gw/StateMultiSelect/index.tsx
//
// Multi-select chip combobox for US states. Used in onboarding compliance-
// profile and the settings practice profile to capture
// `Practice.operatingStates`.
"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { US_STATES, stateName } from "@/lib/states";
import { cn } from "@/lib/utils";

export interface StateMultiSelectProps {
  selectedStates: string[];
  excludeStates?: string[];
  onChange: (next: string[]) => void;
  className?: string;
  disabled?: boolean;
}

export function StateMultiSelect({
  selectedStates,
  excludeStates = [],
  onChange,
  className,
  disabled,
}: StateMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const excludeSet = new Set([...selectedStates, ...excludeStates]);
  const available = US_STATES.filter((s) => !excludeSet.has(s.code));

  const handleAdd = (code: string) => {
    onChange([...selectedStates, code]);
    setOpen(false);
  };

  const handleRemove = (code: string) => {
    onChange(selectedStates.filter((c) => c !== code));
  };

  return (
    <div className={cn("space-y-2", className)}>
      {selectedStates.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" role="list">
          {selectedStates.map((code) => (
            <li key={code}>
              <Badge variant="secondary" className="gap-1.5 pr-1.5 text-sm font-normal">
                {stateName(code)}
                <button
                  type="button"
                  onClick={() => handleRemove(code)}
                  disabled={disabled}
                  aria-label={`Remove ${stateName(code)}`}
                  className="rounded-full p-0.5 hover:bg-secondary-foreground/10 disabled:opacity-50"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={selectedStates.length > 0 ? `Add states (${selectedStates.length} selected)` : "Add states"}
            disabled={disabled || available.length === 0}
            className="w-full justify-start gap-2 font-normal"
          >
            <Plus className="h-4 w-4 opacity-50" aria-hidden="true" />
            <span className="text-muted-foreground">
              {available.length === 0 ? "All states added" : "Add states…"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search states…" />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {available.map((s) => (
                  <CommandItem
                    key={s.code}
                    value={`${s.name} ${s.code}`}
                    onSelect={() => handleAdd(s.code)}
                  >
                    {s.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
