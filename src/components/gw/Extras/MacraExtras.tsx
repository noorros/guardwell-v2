// src/components/gw/Extras/MacraExtras.tsx
//
// MACRA / MIPS Section G helpers:
//   - MipsCompositeEstimator: enter the 4 category scores (Quality, Cost,
//     Improvement Activities, Promoting Interoperability) at their CY weights;
//     surfaces the composite + projected payment adjustment band.
//   - PerformanceCategoryWeights: visual breakdown of the 4 categories'
//     CY weights with brief descriptions of each.

"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CY_2026_WEIGHTS = {
  quality: 0.3,
  cost: 0.3,
  improvement: 0.15,
  interop: 0.25,
} as const;

const PERFORMANCE_THRESHOLD = 75; // CY 2026 threshold for neutral adjustment.
const EXCEPTIONAL_THRESHOLD = 89; // No additional bonus pool from CY 2024 onward, but the threshold name persists.

export function MacraExtras() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <MipsCompositeEstimator />
      <PerformanceCategoryWeights />
    </div>
  );
}

function MipsCompositeEstimator() {
  const [quality, setQuality] = useState("");
  const [cost, setCost] = useState("");
  const [improvement, setImprovement] = useState("");
  const [interop, setInterop] = useState("");
  const q = clamp100(quality);
  const c = clamp100(cost);
  const i = clamp100(improvement);
  const p = clamp100(interop);
  const composite =
    q * CY_2026_WEIGHTS.quality +
    c * CY_2026_WEIGHTS.cost +
    i * CY_2026_WEIGHTS.improvement +
    p * CY_2026_WEIGHTS.interop;
  const compositeRounded = Math.round(composite * 100) / 100;
  const hasInput = quality || cost || improvement || interop;

  // Adjustment band — directional only (the actual factor is set by CMS
  // each year based on budget neutrality + the curve of all reporters).
  let band: string;
  let tone: string;
  if (compositeRounded < PERFORMANCE_THRESHOLD * 0.75) {
    band = "Maximum negative adjustment (~-9% to Part B fee schedule)";
    tone = "var(--gw-color-risk)";
  } else if (compositeRounded < PERFORMANCE_THRESHOLD) {
    band = "Negative adjustment (sliding scale to neutral)";
    tone = "var(--gw-color-needs)";
  } else if (compositeRounded < EXCEPTIONAL_THRESHOLD) {
    band = "Neutral or small positive adjustment";
    tone = "var(--gw-color-setup)";
  } else {
    band = "Positive adjustment (max ~+9%, scaled by budget neutrality)";
    tone = "var(--gw-color-compliant)";
  }

  const fields: Array<{ label: string; val: string; set: (v: string) => void; weight: number }> = [
    { label: "Quality", val: quality, set: setQuality, weight: CY_2026_WEIGHTS.quality },
    { label: "Cost", val: cost, set: setCost, weight: CY_2026_WEIGHTS.cost },
    { label: "Improvement Activities", val: improvement, set: setImprovement, weight: CY_2026_WEIGHTS.improvement },
    { label: "Promoting Interoperability", val: interop, set: setInterop, weight: CY_2026_WEIGHTS.interop },
  ];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">MIPS composite estimator</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Enter your 0–100 score per category. Composite is the
            CY-weighted sum; projected adjustment band is directional —
            CMS sets the actual factor based on budget neutrality.
          </p>
        </div>
        <ul className="space-y-1.5">
          {fields.map((f) => (
            <li key={f.label} className="space-y-0.5">
              <label className="block text-[10px] font-medium text-foreground">
                {f.label}{" "}
                <span className="text-muted-foreground">
                  (weight {Math.round(f.weight * 100)}%)
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={f.val}
                  onChange={(e) => f.set(e.target.value)}
                  placeholder="0"
                  className="mt-0.5 block w-full rounded border bg-background px-1.5 py-1 text-xs tabular-nums"
                />
              </label>
            </li>
          ))}
        </ul>
        {hasInput && (
          <div
            className="rounded-md border p-2 text-xs"
            style={{
              borderColor: tone,
              backgroundColor: `color-mix(in oklch, ${tone} 10%, transparent)`,
            }}
          >
            <p className="font-medium">
              Composite: {compositeRounded.toFixed(1)} / 100
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Performance threshold: {PERFORMANCE_THRESHOLD}. {band}.
            </p>
          </div>
        )}
        <Badge variant="outline" className="text-[10px]">
          CY 2026 QPP final rule weights
        </Badge>
      </CardContent>
    </Card>
  );
}

function PerformanceCategoryWeights() {
  const cats: Array<{ label: string; weight: number; desc: string }> = [
    {
      label: "Quality",
      weight: CY_2026_WEIGHTS.quality,
      desc: "Report on 6 quality measures (or specialty set) for at least 75% of eligible patients across the year.",
    },
    {
      label: "Cost",
      weight: CY_2026_WEIGHTS.cost,
      desc: "Calculated by CMS from your claims data — no submission required. Includes Total Per-Capita Cost + episode-based measures.",
    },
    {
      label: "Improvement Activities",
      weight: CY_2026_WEIGHTS.improvement,
      desc: "Attest to 2–4 medium/high-weighted activities (depends on practice size + special status). Most are achievable with documentation only.",
    },
    {
      label: "Promoting Interoperability",
      weight: CY_2026_WEIGHTS.interop,
      desc: "EHR-based reporting on data exchange, patient access, public-health registries. CEHRT required.",
    },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">CY 2026 category weights</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Special-status clinicians (small practice, hospital-based,
            non-patient-facing) get reweighting that may zero out PI or
            Cost. Verify on the QPP Participation Status Tool.
          </p>
        </div>
        <ul className="space-y-2">
          {cats.map((c) => (
            <li key={c.label} className="rounded-md border p-2 text-[11px]">
              <div className="flex items-center justify-between">
                <p className="font-medium text-foreground">{c.label}</p>
                <span className="font-semibold tabular-nums text-muted-foreground">
                  {Math.round(c.weight * 100)}%
                </span>
              </div>
              <p className="text-muted-foreground">{c.desc}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function clamp100(s: string): number {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}
