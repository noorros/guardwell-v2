// src/app/(dashboard)/programs/incidents/[id]/BreachDeterminationWizard.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { completeBreachDeterminationAction } from "../actions";

interface FactorDef {
  id: 1 | 2 | 3 | 4;
  title: string;
  description: string;
}

// HIPAA §164.402 four factors. Each gets a 1-5 score; 1 = low probability
// of compromise, 5 = high probability.
const FACTORS: FactorDef[] = [
  {
    id: 1,
    title: "Nature and extent of the PHI involved",
    description:
      "Identifiers, types of PHI (diagnoses, financial, genetic), and likelihood of re-identification. More sensitive = higher score.",
  },
  {
    id: 2,
    title: "Unauthorized person who used the PHI or to whom disclosure was made",
    description:
      "Could the recipient reuse or re-disclose? Another covered entity bound by HIPAA = lower. A member of the general public or a hostile actor = higher.",
  },
  {
    id: 3,
    title: "Whether the PHI was actually acquired or viewed",
    description:
      "Proof the unauthorized person didn't access the data (forensic logs, returned device) reduces the score.",
  },
  {
    id: 4,
    title: "Extent to which the risk has been mitigated",
    description:
      "Retrieval, destruction, confidentiality agreements, and other remediation actions reduce the score.",
  },
];

export function BreachDeterminationWizard({
  incidentId,
  defaultAffectedCount,
}: {
  incidentId: string;
  defaultAffectedCount: number;
}) {
  const [scores, setScores] = useState<Record<number, number>>({});
  const [affectedCount, setAffectedCount] = useState<string>(
    String(defaultAffectedCount),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const allScored = FACTORS.every((f) => scores[f.id]);
  const sum = FACTORS.reduce((acc, f) => acc + (scores[f.id] ?? 0), 0);
  const previewScore = Math.round((sum / (FACTORS.length * 5)) * 100);
  const hasMaxFactor = FACTORS.some((f) => scores[f.id] === 5);
  const previewIsBreach = hasMaxFactor || previewScore >= 50;

  const handleSubmit = () => {
    setError(null);
    if (!allScored) {
      setError("Score every factor before submitting the determination.");
      return;
    }
    const parsedCount = Number.parseInt(affectedCount, 10);
    if (Number.isNaN(parsedCount) || parsedCount < 0) {
      setError("Affected count must be a non-negative integer.");
      return;
    }
    startTransition(async () => {
      try {
        await completeBreachDeterminationAction({
          incidentId,
          factor1Score: scores[1]!,
          factor2Score: scores[2]!,
          factor3Score: scores[3]!,
          factor4Score: scores[4]!,
          affectedCount: parsedCount,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Submission failed");
      }
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-sm font-semibold">Breach determination</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            HIPAA §164.402 "low probability of compromise" analysis. Score each
            factor 1–5 (1 = low probability, 5 = high). Any single factor at 5,
            or a composite ≥ 50, triggers breach notification obligations.
          </p>
        </div>

        <ol className="space-y-4">
          {FACTORS.map((f) => (
            <li key={f.id} className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium text-foreground">
                Factor {f.id}. {f.title}
              </p>
              <p className="text-xs text-muted-foreground">{f.description}</p>
              <div
                role="radiogroup"
                aria-label={`Factor ${f.id} score`}
                className="flex flex-wrap gap-1"
              >
                {[1, 2, 3, 4, 5].map((s) => {
                  const selected = scores[f.id] === s;
                  return (
                    <label
                      key={s}
                      className={`inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-accent/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`factor-${f.id}`}
                        value={s}
                        checked={selected}
                        onChange={() =>
                          setScores((p) => ({ ...p, [f.id]: s }))
                        }
                        className="sr-only"
                      />
                      {s}
                    </label>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>

        <label className="block space-y-1 text-xs font-medium text-foreground">
          Affected count (individuals whose PHI was involved)
          <input
            type="number"
            min={0}
            value={affectedCount}
            onChange={(e) => setAffectedCount(e.target.value)}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>

        {allScored && (
          <div
            className="rounded-md border p-3 text-xs"
            style={{
              borderColor: previewIsBreach
                ? "var(--gw-color-risk)"
                : "var(--gw-color-compliant)",
              backgroundColor: `color-mix(in oklch, ${
                previewIsBreach
                  ? "var(--gw-color-risk)"
                  : "var(--gw-color-compliant)"
              } 10%, transparent)`,
            }}
          >
            <p className="font-medium">
              Preview: composite {previewScore}/100 ·{" "}
              {previewIsBreach ? "Reportable breach" : "Not a reportable breach"}
            </p>
          </div>
        )}

        {error && (
          <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!allScored || isPending}
          >
            {isPending ? "Submitting…" : "Submit determination"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
