// src/components/gw/Extras/HipaaExtras.tsx
//
// HIPAA-specific Section G helpers. Two cards:
//   - BreachReportableCalculator: 4-factor risk score sandbox so the user
//     can model a hypothetical incident before opening the real wizard.
//   - NppDelivery: quick reference for Notice of Privacy Practices delivery
//     methods (initial, posted, electronic, request fulfillment).

"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function HipaaExtras() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <BreachReportableCalculator />
      <NppDeliveryReference />
    </div>
  );
}

function BreachReportableCalculator() {
  const [scores, setScores] = useState<Record<number, number>>({});
  const allScored = [1, 2, 3, 4].every((id) => scores[id]);
  const sum = [1, 2, 3, 4].reduce((acc, id) => acc + (scores[id] ?? 0), 0);
  const composite = Math.round((sum / 20) * 100);
  const hasFive = Object.values(scores).some((v) => v === 5);
  const reportable = hasFive || composite >= 50;

  const factors = [
    { id: 1, label: "Nature/extent of PHI" },
    { id: 2, label: "Who used/received it" },
    { id: 3, label: "Actually acquired or viewed?" },
    { id: 4, label: "Risk mitigated?" },
  ] as const;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">Breach reportable calculator</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Sandbox the §164.402 4-factor analysis. Doesn&apos;t record an
            event — open an incident from /programs/incidents to log the
            actual determination.
          </p>
        </div>
        <ul className="space-y-1.5">
          {factors.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2">
              <span className="text-xs text-foreground">
                Factor {f.id}. {f.label}
              </span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((s) => {
                  const selected = scores[f.id] === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-label={`Factor ${f.id} score ${s}`}
                      aria-pressed={selected}
                      onClick={() =>
                        setScores((p) => ({ ...p, [f.id]: s }))
                      }
                      className={`h-6 w-6 rounded text-[10px] font-medium transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "border bg-background hover:bg-accent"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        {allScored && (
          <div
            className="rounded-md border p-2 text-xs"
            style={{
              borderColor: reportable
                ? "var(--gw-color-risk)"
                : "var(--gw-color-compliant)",
              backgroundColor: `color-mix(in oklch, ${
                reportable
                  ? "var(--gw-color-risk)"
                  : "var(--gw-color-compliant)"
              } 10%, transparent)`,
            }}
          >
            <p className="font-medium">
              Composite {composite}/100 ·{" "}
              {reportable ? "Reportable breach" : "Not reportable"}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Trigger: any single factor at 5, OR composite ≥ 50. Recompute
              against the actual incident in the wizard before relying on
              this for a regulatory decision.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NppDeliveryReference() {
  const items: Array<{ situation: string; method: string }> = [
    {
      situation: "First time a patient receives services",
      method:
        "Provide a copy + obtain a written acknowledgment of receipt. Document any good-faith effort if patient declines to sign.",
    },
    {
      situation: "Posted in the practice",
      method:
        "Display in a prominent location patients can read (waiting area). Required even if every patient also receives a copy.",
    },
    {
      situation: "Practice website",
      method:
        "Post the NPP prominently on any site that provides info about services or benefits. The full text — not a summary.",
    },
    {
      situation: "Patient requests a copy",
      method:
        "Provide a copy promptly on request, in the form requested (paper or electronic) where reasonably possible.",
    },
    {
      situation: "After material revision",
      method:
        "Make the revised NPP available at the next service date. Post the revised version. No re-acknowledgment required for prior patients unless your state requires it.",
    },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">NPP delivery quick reference</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Notice of Privacy Practices §164.520. Posting + acknowledgment
            are separate obligations — both required.
          </p>
        </div>
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.situation}
              className="rounded-md border p-2 text-[11px]"
            >
              <p className="font-medium text-foreground">{it.situation}</p>
              <p className="mt-0.5 text-muted-foreground">{it.method}</p>
            </li>
          ))}
        </ul>
        <Badge variant="outline" className="text-[10px]">
          §164.520
        </Badge>
      </CardContent>
    </Card>
  );
}
