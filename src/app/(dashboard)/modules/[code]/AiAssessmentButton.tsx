// src/app/(dashboard)/modules/[code]/AiAssessmentButton.tsx
"use client";

import { useTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { runAiAssessmentAction } from "@/app/(dashboard)/modules/hipaa/assess/actions";

export function AiAssessmentButton({ frameworkCode }: { frameworkCode: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (frameworkCode.toUpperCase() !== "HIPAA") {
    return null; // Only wired for HIPAA in week 5.
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-[color:var(--gw-color-risk)]">{error}</span>}
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await runAiAssessmentAction();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Assessment failed");
            }
          })
        }
      >
        {pending ? "Running…" : "Run AI assessment"}
      </Button>
    </div>
  );
}
