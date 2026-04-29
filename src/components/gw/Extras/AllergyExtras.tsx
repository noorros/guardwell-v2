// src/components/gw/Extras/AllergyExtras.tsx
//
// ALLERGY / USP §797 Section G helpers:
//   - BudQuickReference: static reference card for USP §797 §21.4 BUD
//     assignment rules for sterile compounded preparations.
//   - VialLabelGenerator: interactive vial label template with BUD
//     calculator based on base date + preparation type.

"use client";

import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

export function AllergyExtras({
  practiceName,
}: {
  practiceName: string;
  practicePrimaryState: string;
  practiceProviderCount: string | null;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <BudQuickReference />
      <VialLabelGenerator practiceName={practiceName} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 1: Beyond-Use Date Quick Reference
// ---------------------------------------------------------------------------

const BUD_RULES = [
  {
    type: "Aqueous (water-based) solutions",
    roomTemp: "7 days",
    refrigerated: "14 days (2–8°C)",
    frozen: null,
    note: "Most allergen extracts and aqueous injections fall here.",
  },
  {
    type: "Non-aqueous solutions",
    roomTemp: "14 days",
    refrigerated: "30 days",
    frozen: null,
    note: "Glycerinated concentrates and anhydrous vehicles.",
  },
  {
    type: "Frozen preparations",
    roomTemp: null,
    refrigerated: null,
    frozen: "45 days at −20°C or colder",
    note: "Must be stored in a dedicated freezer; never refreeze after thaw.",
  },
];

function BudQuickReference() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            Beyond-Use Date (BUD) quick reference
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            BUD is <em>not</em> an expiration date. It is the date and time
            after which a compounded sterile preparation (CSP) must not be
            administered. Assign BUD at the time of compounding per the rules
            below; label every vial accordingly.
          </p>
        </div>

        <ul className="space-y-2">
          {BUD_RULES.map((rule) => (
            <li key={rule.type} className="rounded-md border p-2 text-[11px]">
              <p className="font-medium text-foreground">{rule.type}</p>
              <div className="mt-1 space-y-0.5 text-muted-foreground">
                {rule.roomTemp && (
                  <p>
                    <span className="font-medium text-foreground">
                      Room temp:
                    </span>{" "}
                    {rule.roomTemp}
                  </p>
                )}
                {rule.refrigerated && (
                  <p>
                    <span className="font-medium text-foreground">
                      Refrigerated:
                    </span>{" "}
                    {rule.refrigerated}
                  </p>
                )}
                {rule.frozen && (
                  <p>
                    <span className="font-medium text-foreground">Frozen:</span>{" "}
                    {rule.frozen}
                  </p>
                )}
                <p className="mt-1 italic">{rule.note}</p>
              </div>
            </li>
          ))}
        </ul>

        <Badge variant="outline" className="text-[10px]">
          USP 797 §21.4 — BUD assignment rules
        </Badge>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card 2: Vial Label Generator
// ---------------------------------------------------------------------------

type BudType = "aqueous-room" | "aqueous-ref" | "nonaqueous-room" | "nonaqueous-ref" | "frozen";

const BUD_OFFSETS: Record<BudType, number> = {
  "aqueous-room": 7,
  "aqueous-ref": 14,
  "nonaqueous-room": 14,
  "nonaqueous-ref": 30,
  frozen: 45,
};

const BUD_LABELS: Record<BudType, string> = {
  "aqueous-room": "Aqueous — room temp (7 days)",
  "aqueous-ref": "Aqueous — refrigerated (14 days, 2–8°C)",
  "nonaqueous-room": "Non-aqueous — room temp (14 days)",
  "nonaqueous-ref": "Non-aqueous — refrigerated (30 days)",
  frozen: "Frozen — −20°C or colder (45 days)",
};

const STORAGE_NOTES: Record<BudType, string> = {
  "aqueous-room": "STORAGE: Store at room temperature (15–30°C). Protect from light.",
  "aqueous-ref": "STORAGE: Refrigerate 2–8°C. Do not freeze. Protect from light.",
  "nonaqueous-room": "STORAGE: Store at room temperature (15–30°C). Protect from light.",
  "nonaqueous-ref": "STORAGE: Refrigerate 2–8°C. Do not freeze.",
  frozen: "STORAGE: Freeze at −20°C or colder. Do not refreeze after thaw.",
};

function addDays(dateStr: string, days: number, tz: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00"); // noon avoids DST edge cases
  d.setDate(d.getDate() + days);
  return formatPracticeDate(d, tz);
}

function VialLabelGenerator({ practiceName }: { practiceName: string }) {
  const tz = usePracticeTimezone();
  const today = formatPracticeDate(new Date(), tz);

  const [baseDate, setBaseDate] = useState<string>(today);
  const [budType, setBudType] = useState<BudType>("aqueous-ref");

  const preparedDisplay = baseDate
    ? formatPracticeDate(new Date(baseDate + "T12:00:00"), tz)
    : "—";
  const budDisplay = baseDate ? addDays(baseDate, BUD_OFFSETS[budType], tz) : "—";

  const labelText = [
    `${practiceName}`,
    ``,
    `PATIENT: [Patient Name]`,
    `COMPOUND: [Compound Name / Concentration]`,
    ``,
    `DATE PREPARED: ${preparedDisplay}`,
    `BEYOND-USE DATE: ${budDisplay}`,
    ``,
    `LOT #: [Lot Number]`,
    `COMPOUNDER INITIALS: ____`,
    ``,
    STORAGE_NOTES[budType],
    ``,
    `For use by prescribing physician only. Not for resale.`,
  ].join("\n");

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">Vial label template</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Select the preparation date and BUD type below. The label text
            updates with calculated dates — copy it directly into your label
            printing software or paste into the practice&apos;s label template.
          </p>
        </div>

        {/* Controls */}
        <div className="space-y-2 text-[11px]">
          <div className="flex items-center gap-2">
            <label
              htmlFor="allergy-base-date"
              className="w-28 shrink-0 font-medium text-foreground"
            >
              Date prepared
            </label>
            <input
              id="allergy-base-date"
              type="date"
              value={baseDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setBaseDate(e.target.value)
              }
              className="h-7 rounded-md border px-2 text-[11px]"
            />
          </div>

          <fieldset className="space-y-1">
            <legend className="text-[10px] font-medium text-foreground">
              Preparation type / storage
            </legend>
            <div className="space-y-0.5">
              {(Object.keys(BUD_LABELS) as BudType[]).map((opt) => (
                <label key={opt} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="allergy-bud-type"
                    value={opt}
                    checked={budType === opt}
                    onChange={() => setBudType(opt)}
                  />
                  <span>{BUD_LABELS[opt]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Label preview */}
        <div className="rounded-md border bg-muted/30 p-2 font-mono text-[10px] text-foreground whitespace-pre">
          {labelText}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard?.writeText(labelText)}
        >
          Copy label text
        </Button>

        <Badge variant="outline" className="text-[10px]">
          USP 797 §21.4 — BUD assignment rules
        </Badge>
      </CardContent>
    </Card>
  );
}
