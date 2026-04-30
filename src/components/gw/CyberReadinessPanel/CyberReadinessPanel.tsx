// src/components/gw/CyberReadinessPanel/CyberReadinessPanel.tsx
//
// Server component that fetches the cyber readiness snapshot and
// renders a compact panel for the HIPAA module page (Section G area).
// Mirrors the score card from /programs/cybersecurity but condensed:
// just the score + per-component status row + deep link.

import Link from "next/link";
import type { Route } from "next";
import { ShieldCheck, ArrowRight, AlertCircle, CheckCircle2, CircleDashed } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { computeCyberReadiness } from "@/lib/cyber/readiness";
import { scoreToColorToken } from "@/lib/utils";

export interface CyberReadinessPanelProps {
  practiceId: string;
  practiceTimezone?: string;
}

export async function CyberReadinessPanel({
  practiceId,
  practiceTimezone = "UTC",
}: CyberReadinessPanelProps) {
  const snapshot = await computeCyberReadiness(db, practiceId, practiceTimezone);
  const scoreColor = scoreToColorToken(snapshot.total);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Cyber readiness</h3>
          </div>
          <Link
            href={"/programs/cybersecurity" as Route}
            className="flex items-center gap-1 text-[11px] text-foreground underline hover:no-underline"
          >
            Open program
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        <div className="flex items-baseline gap-3">
          <p
            className="text-3xl font-semibold tabular-nums"
            style={{ color: `var(--${scoreColor})` }}
          >
            {snapshot.total}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              / 100
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Aggregates the four cybersecurity HIPAA Security-Rule
            requirements: training, MFA, phishing drills, backup
            verification, plus PHI encryption.
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {snapshot.components.map((c) => {
            const Icon =
              c.status === "PASS"
                ? CheckCircle2
                : c.status === "FAIL"
                  ? AlertCircle
                  : CircleDashed;
            const tone =
              c.status === "PASS"
                ? "var(--gw-color-compliant)"
                : c.status === "FAIL"
                  ? "var(--gw-color-risk)"
                  : "var(--muted-foreground)";
            return (
              <li
                key={c.key}
                className="flex items-start gap-2 rounded-md border bg-background/40 p-2 text-[11px]"
              >
                <Icon
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                  style={{ color: tone }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {c.label}
                  </p>
                  <p className="text-muted-foreground" title={c.detail}>
                    {c.earned}/{c.max} pts
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
