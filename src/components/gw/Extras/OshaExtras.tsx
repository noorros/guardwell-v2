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
import { Osha300AReminder } from "@/components/gw/Osha300AReminder";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";

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
  // Phase 2 B1 (v2 feature recovery): TZ-aware Feb 1–Apr 30 banner.
  // The reminder is self-hiding outside the window so it stays mounted
  // year-round without polluting the page.
  const tz = usePracticeTimezone();
  return (
    <div className="space-y-4">
      <Osha300AReminder tz={tz} href="/api/audit/osha-300" />
      <div className="grid gap-4 md:grid-cols-2">
        <Form300AWorksheet />
        <OshaPostingChecklist />
      </div>
      <BloodbornePathogensEcpTemplate />
    </div>
  );
}

function BloodbornePathogensEcpTemplate() {
  // §1910.1030(c)(1)(i) requires a written Exposure Control Plan for any
  // facility with reasonably anticipated occupational exposure to blood
  // or other potentially infectious materials. Annual review required.
  const sections: Array<{ heading: string; bullets: string[] }> = [
    {
      heading: "1. Exposure determination",
      bullets: [
        "List job classifications with exposure (e.g. RN, MA, LPN, Phlebotomist).",
        "List tasks/procedures involving exposure (venipuncture, sharps handling, instrument cleaning, vaccine administration).",
      ],
    },
    {
      heading: "2. Methods of compliance",
      bullets: [
        "Universal precautions used at all times.",
        "Engineering controls — sharps containers, safer needle devices, biohazard bags.",
        "Work-practice controls — no recapping needles, hand hygiene after glove removal.",
        "PPE — gloves required for venipuncture; eye protection + masks where splash risk exists.",
        "Housekeeping — written cleaning + decontamination schedule per surface type.",
      ],
    },
    {
      heading: "3. Hepatitis B vaccination",
      bullets: [
        "Offered free of charge within 10 working days of initial assignment to at-risk roles.",
        "Declination form on file for any employee who declines (OSHA-specified language).",
      ],
    },
    {
      heading: "4. Post-exposure evaluation + follow-up",
      bullets: [
        "Confidential medical evaluation offered immediately after any exposure incident.",
        "Source-individual blood test (with consent) + employee testing per CDC protocol.",
        "Healthcare-professional written opinion provided to employee within 15 days.",
      ],
    },
    {
      heading: "5. Communication of hazards",
      bullets: [
        "Biohazard labels on contaminated equipment + containers.",
        "Initial + annual training documented for all at-risk staff.",
      ],
    },
    {
      heading: "6. Recordkeeping",
      bullets: [
        "Sharps Injury Log maintained (separate from OSHA 300; CDC NaSH-style format acceptable).",
        "Training records retained 3 years; medical records retained for duration of employment + 30 years.",
      ],
    },
    {
      heading: "7. Annual review",
      bullets: [
        "Plan reviewed + updated annually + whenever procedures change.",
        "Employees solicited for input on safer engineering controls.",
      ],
    },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            Bloodborne Pathogens Exposure Control Plan template
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            §1910.1030(c)(1)(i) requires a written Exposure Control Plan for
            any facility with reasonably anticipated occupational exposure to
            blood or OPIM. Annual review + updates required. Use this
            outline to draft your practice-specific ECP.
          </p>
        </div>
        <ol className="space-y-2 text-[11px]">
          {sections.map((sec) => (
            <li key={sec.heading} className="rounded-md border p-2">
              <p className="font-semibold text-foreground">{sec.heading}</p>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {sec.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <Badge variant="outline" className="text-[10px]">
          29 CFR §1910.1030
        </Badge>
      </CardContent>
    </Card>
  );
}

// Caps for the Form 300A worksheet inputs (audit #21 OSHA I-7).
// Each is generous enough not to clamp legitimate inputs while keeping
// nonsense values from triggering NaN/Infinity in the TRIR/DART math.
//   - Hours worked: a 1000-employee org × 2080 hrs × 100 years still
//     comes in well under 100M.
//   - Day counts (per category total): cap at 36500 — enough for 100
//     employees each contributing the §1904.7 single-incident max of 365
//     days. Per-incident cap of 180 lives on the Incident schema.
//   - Case counts / employee count: 1,000,000 covers any practice size
//     this product targets and is a comfortable sanity ceiling.
const CAP_HOURS = 100_000_000;
const CAP_DAY_COUNT = 36_500;
const CAP_CASE_COUNT = 1_000_000;

function clampNonNegative(n: number, cap: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > cap) return cap;
  return n;
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

  const fields: Array<{
    key: keyof Form300AInputs;
    label: string;
    hint?: string;
    cap: number;
    parser: "int" | "float";
  }> = [
    { key: "deaths", label: "Deaths", cap: CAP_CASE_COUNT, parser: "int" },
    { key: "daysAway", label: "Days-away cases", cap: CAP_CASE_COUNT, parser: "int" },
    { key: "restricted", label: "Restricted-duty cases", cap: CAP_CASE_COUNT, parser: "int" },
    { key: "otherRecordable", label: "Other recordable", cap: CAP_CASE_COUNT, parser: "int" },
    { key: "daysAwayTotal", label: "Total days away from work", cap: CAP_DAY_COUNT, parser: "int" },
    { key: "daysRestrictedTotal", label: "Total days of restricted duty", cap: CAP_DAY_COUNT, parser: "int" },
    {
      key: "averageEmployees",
      label: "Annual average # employees",
      hint: "Sum of headcount per pay period ÷ # pay periods",
      cap: CAP_CASE_COUNT,
      parser: "int",
    },
    {
      key: "hoursWorked",
      label: "Total hours worked",
      hint: "Sum across all employees",
      cap: CAP_HOURS,
      // hours can be fractional in payroll exports; round to int for OSHA Form 300A.
      parser: "float",
    },
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
                  max={f.cap}
                  value={v[f.key]}
                  onChange={(e) => {
                    const raw = e.target.value;
                    // Hours can come in as decimals from payroll exports
                    // (e.g. "2080.5"); parseFloat + round avoids losing the
                    // decimal silently, and Number.isFinite catches NaN
                    // before it propagates to the TRIR math.
                    const parsed =
                      f.parser === "float"
                        ? Math.round(Number.parseFloat(raw))
                        : Number.parseInt(raw, 10);
                    setV({ ...v, [f.key]: clampNonNegative(parsed, f.cap) });
                  }}
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
