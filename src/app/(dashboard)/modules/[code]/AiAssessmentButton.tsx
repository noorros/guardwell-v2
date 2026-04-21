// src/app/(dashboard)/modules/[code]/AiAssessmentButton.tsx
"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { runAiAssessmentAction } from "@/app/(dashboard)/modules/hipaa/assess/actions";

export function AiAssessmentButton({ frameworkCode }: { frameworkCode: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (frameworkCode.toUpperCase() !== "HIPAA") {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-[color:var(--gw-color-risk)]">{error}</span>}
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  try {
                    await runAiAssessmentAction();
                    router.refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Assessment failed");
                  }
                })
              }
            >
              {pending ? "Running…" : "Run AI assessment"}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-xs">
            Claude scans your practice profile + state and fills in a likely
            status (Compliant / Gap / Not started) for each requirement. You
            can override any status by clicking it. Runs at most once every
            24 hours per practice.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
