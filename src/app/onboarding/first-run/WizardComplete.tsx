// src/app/onboarding/first-run/WizardComplete.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { completeFirstRunAction } from "./actions";

const STEPS = ["OFFICERS", "POLICY", "TRAINING", "INVITE"];

export function WizardComplete() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  useEffect(() => {
    if (recorded) return;
    // Fire the celebration BEFORE the server round-trip so it feels instant.
    confetti({
      particleCount: 120,
      spread: 90,
      origin: { y: 0.3 },
    });
    // Record the completion.
    completeFirstRunAction({
      stepsCompleted: STEPS,
      durationSeconds: 0,
    })
      .then(() => setRecorded(true))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Record failed"),
      );
  }, [recorded]);

  return (
    <div className="space-y-4 text-center">
      <h2 className="text-2xl font-semibold">You're at compliance score 30 🎉</h2>
      <p className="text-sm text-muted-foreground">
        Privacy + Security Officers named · Privacy Policy adopted · HIPAA Basics
        complete · Team invited. Your Compliance Track is waiting on the
        dashboard with the next steps.
      </p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-center">
        <Button
          onClick={() => router.push("/dashboard" as Route)}
          disabled={!recorded}
        >
          Go to dashboard →
        </Button>
      </div>
    </div>
  );
}
