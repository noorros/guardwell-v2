// src/components/gw/Extras/OshaExtras.tsx
//
// OSHA Section G helper: 300A annual-summary worksheet. Sums the
// recordable cases per OSHA's own categorization (DEATH, DAYS_AWAY,
// RESTRICTED, OTHER_RECORDABLE) so the user can pre-fill the form 300A
// they post Feb 1 – Apr 30 each year.

"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Form300AInputs {
  deaths: number;
  daysAway: number;
  restricted: number;
  otherRecordable: number;
  daysAwayTotal: number;
  daysRestrictedTotal: number;
  averageEmployees: number;
  hoursWorked: number;
}

const ZERO: Form300AInputs = {
  deaths: 0,
  daysAway: 0,
  restricted: 0,
  otherRecordable: 0,
  daysAwayTotal: 0,
  daysRestrictedTotal: 0,
  averageEmployees: 0,
  hoursWorked: 0,
};

export function OshaExtras() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Form300AWorksheet />
      <OshaPostingChecklist />
    </div>
  );
}

function Form300AWorksheet() {
  const [v, setV] = useState<Form300AInputs>(ZERO);
  const totalCases =
    v.deaths + v.daysAway + v.restricted + v.otherRecordable;
  // OSHA DART rate (Days Away Restricted Transferred) per 100 FTEs.
  // Formula: (DART cases × 200,000) / hours worked.
  const dartCases = v.daysAway + v.restricted;
  const dartRate =
    v.hoursWorked > 0
      ? Math.round(((dartCases * 200_000) / v.hoursWorked) * 100) / 100
      : null;
  const trir =
    v.hoursWorked > 0
      ? Math.round(((totalCases * 200_000) / v.hoursWorked) * 100) / 100
      : null;

  const fields: Array<{ key: keyof Form300AInputs; label: string; hint?: string }> = [
    { key: "deaths", label: "Deaths" },
    { key: "daysAway", label: "Days-away cases" },
    { key: "restricted", label: "Restricted-duty cases" },
    { key: "otherRecordable", label: "Other recordable" },
    { key: "daysAwayTotal", label: "Total days away from work" },
    { key: "daysRestrictedTotal", label: "Total days of restricted duty" },
    {
      key: "averageEmployees",
      label: "Annual average # employees",
      hint: "Sum of headcount per pay period ÷ # pay periods",
    },
    { key: "hoursWorked", label: "Total hours worked", hint: "Sum across all employees" },
  ];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">Form 300A worksheet</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Annual summary required Feb 1–Apr 30 each year. Sandbox; doesn&apos;t
            persist. Pre-fill from /programs/incidents (filter type=OSHA_RECORDABLE).
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-1.5">
          {fields.map((f) => (
            <li key={f.key} className="space-y-0.5">
              <label className="block text-[10px] font-medium text-foreground">
                {f.label}
                <input
                  type="number"
                  min={0}
                  value={v[f.key]}
                  onChange={(e) =>
                    setV({
                      ...v,
                      [f.key]: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                    })
                  }
                  className="mt-0.5 block w-full rounded border bg-background px-1.5 py-1 text-xs tabular-nums"
                />
              </label>
              {f.hint && (
                <p className="text-[9px] text-muted-foreground">{f.hint}</p>
              )}
            </li>
          ))}
        </ul>
        <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
          <p>
            Total recordable cases:{" "}
            <span className="font-semibold tabular-nums">{totalCases}</span>
          </p>
          {trir !== null && (
            <p>
              TRIR (per 100 FTEs):{" "}
              <span className="font-semibold tabular-nums">{trir}</span>
            </p>
          )}
          {dartRate !== null && (
            <p>
              DART rate:{" "}
              <span className="font-semibold tabular-nums">{dartRate}</span>
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setV(ZERO)}
        >
          Reset
        </Button>
      </CardContent>
    </Card>
  );
}

function OshaPostingChecklist() {
  const items: Array<{ poster: string; req: string; where: string }> = [
    {
      poster: "OSHA Job Safety & Health: It's the Law",
      req: "Required at all times",
      where: "Visible employee location (break room, time clock area)",
    },
    {
      poster: "Form 300A annual summary",
      req: "Feb 1 – Apr 30 each year",
      where: "Same location, even if no recordable injuries (post zeros)",
    },
    {
      poster: "Hazard Communication / GHS chemical labels",
      req: "Required if any hazardous chemicals on premises",
      where: "Each container labeled; SDS accessible to staff",
    },
    {
      poster: "Bloodborne Pathogens Exposure Control Plan",
      req: "Required + reviewed annually",
      where: "Available to staff (binder or shared drive); employees told where",
    },
    {
      poster: "Emergency Action Plan",
      req: "Required if 11+ employees",
      where: "Posted near exits + reviewed in onboarding",
    },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">OSHA posting + plan checklist</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            What needs to be visibly posted vs. internally maintained.
            Inspectors check for the &ldquo;It&apos;s the Law&rdquo; poster first
            — it&apos;s the easiest citation.
          </p>
        </div>
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.poster} className="rounded-md border p-2 text-[11px]">
              <p className="font-medium text-foreground">{it.poster}</p>
              <p className="text-muted-foreground">
                <span className="font-medium">When:</span> {it.req}
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium">Where:</span> {it.where}
              </p>
            </li>
          ))}
        </ul>
        <Badge variant="outline" className="text-[10px]">
          29 CFR §1903.2 + Subpart Z
        </Badge>
      </CardContent>
    </Card>
  );
}
