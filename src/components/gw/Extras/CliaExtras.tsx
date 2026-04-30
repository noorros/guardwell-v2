// src/components/gw/Extras/CliaExtras.tsx
//
// CLIA Section G helpers:
//   - WaivedTestQuickRef: shortlist of CLIA-waived tests practices
//     commonly run on-site, with the regulatory bullet for each.
//   - QcLogBuilder: assembled-on-the-fly daily QC log row helper. Outputs
//     the line a CLIA inspector wants to see in the bench QC log.

"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

export function CliaExtras() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <WaivedTestQuickRef />
      <QcLogBuilder />
    </div>
  );
}

function WaivedTestQuickRef() {
  const tests: Array<{ name: string; rule: string }> = [
    {
      name: "Rapid strep / rapid flu / rapid COVID antigen",
      rule: "Manufacturer's directions are the QC rule. Run controls per the package insert (often once per kit lot + new operator).",
    },
    {
      name: "Urine dipstick / hCG urine",
      rule: "Run positive + negative QC at frequency stated by manufacturer; document each. Expired strips = non-compliance even if the test ran.",
    },
    {
      name: "Glucose meter (CLIA-waived)",
      rule: "QC daily on each meter in use. Linearity check + new lot/calibrator verification per manufacturer.",
    },
    {
      name: "Hemoglobin / Hgb A1c (waived analyzers)",
      rule: "Two levels of control on each day of testing + with each new reagent lot. Cleared waived models only.",
    },
    {
      name: "PT/INR fingerstick",
      rule: "External QC per manufacturer (often once per month per cuvette lot) + onboard system check. Document.",
    },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            CLIA-waived test quick reference
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Common in-office waived tests + the QC frequency a CLIA
            inspector expects to see logged. Always defer to the
            manufacturer&apos;s package insert when stricter.
          </p>
        </div>
        <ul className="space-y-2">
          {tests.map((t) => (
            <li key={t.name} className="rounded-md border p-2 text-[11px]">
              <p className="font-medium text-foreground">{t.name}</p>
              <p className="text-muted-foreground">{t.rule}</p>
            </li>
          ))}
        </ul>
        <Badge variant="outline" className="text-[10px]">
          42 CFR §493.15 (waived) + manufacturer instructions
        </Badge>
      </CardContent>
    </Card>
  );
}

function QcLogBuilder() {
  const tz = usePracticeTimezone();
  const [analyte, setAnalyte] = useState("");
  const [lot, setLot] = useState("");
  const [exp, setExp] = useState("");
  const [level1, setLevel1] = useState("");
  const [level2, setLevel2] = useState("");
  const [tech, setTech] = useState("");
  const [pass, setPass] = useState<"yes" | "no" | "">("");
  const today = formatPracticeDate(new Date(), tz);
  const ready = analyte && lot && tech && pass;
  const line = ready
    ? `${today} · ${analyte} · Lot ${lot}${exp ? ` (exp ${exp})` : ""} · L1 ${level1 || "—"} · L2 ${level2 || "—"} · Tech ${tech} · ${pass === "yes" ? "Within range" : "OUT OF RANGE — corrective action recorded"}`
    : null;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">QC log line builder</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Assemble a single QC log entry in the format inspectors expect.
            Doesn&apos;t persist anywhere — copy the result into your bench QC
            log (paper or LIS).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          {[
            { label: "Analyte", val: analyte, set: setAnalyte, full: false },
            { label: "Reagent lot", val: lot, set: setLot, full: false },
            { label: "Lot exp date", val: exp, set: setExp, type: "date", full: false },
            { label: "Operator initials", val: tech, set: setTech, full: false },
            { label: "Level 1 result", val: level1, set: setLevel1, full: false },
            { label: "Level 2 result", val: level2, set: setLevel2, full: false },
          ].map((f) => (
            <label
              key={f.label}
              className={`block text-[10px] font-medium text-foreground ${f.full ? "col-span-2" : ""}`}
            >
              {f.label}
              <input
                type={f.type ?? "text"}
                value={f.val}
                onChange={(e) => f.set(e.target.value)}
                className="mt-0.5 block w-full rounded border bg-background px-1.5 py-1 text-xs"
              />
            </label>
          ))}
          <fieldset className="col-span-2 space-y-1">
            <legend className="text-[10px] font-medium text-foreground">
              Result vs. acceptable range
            </legend>
            <div className="flex gap-2">
              {[
                { v: "yes", label: "Within range" },
                { v: "no", label: "Out of range" },
              ].map((opt) => (
                <label key={opt.v} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="qc-pass"
                    value={opt.v}
                    checked={pass === opt.v}
                    onChange={() => setPass(opt.v as "yes" | "no")}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        {line && (
          <div className="rounded-md border bg-muted/30 p-2 text-[10px] font-mono">
            {line}
          </div>
        )}
        {pass === "no" && (
          <p className="text-[10px] text-[color:var(--gw-color-risk)]">
            Out-of-range QC requires patient-result hold + repeat-with-fresh-control
            + documented corrective action before resuming patient testing.
          </p>
        )}
        <Badge variant="outline" className="text-[10px]">
          42 CFR §493.1256 (QC standards)
        </Badge>
      </CardContent>
    </Card>
  );
}
