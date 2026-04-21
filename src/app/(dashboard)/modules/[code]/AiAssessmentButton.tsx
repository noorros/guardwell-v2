// src/app/(dashboard)/modules/[code]/AiAssessmentButton.tsx
"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
    </div>
  );
}
