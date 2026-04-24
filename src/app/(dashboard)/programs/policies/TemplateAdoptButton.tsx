// src/app/(dashboard)/programs/policies/TemplateAdoptButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { adoptPolicyFromTemplateAction } from "./actions";

export interface TemplateAdoptButtonProps {
  templateCode: string;
  alreadyAdopted: boolean;
}

export function TemplateAdoptButton({
  templateCode,
  alreadyAdopted,
}: TemplateAdoptButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleAdopt = () => {
    setError(null);
    startTransition(async () => {
      try {
        await adoptPolicyFromTemplateAction({ templateCode });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to adopt");
      }
    });
  };

  if (alreadyAdopted) {
    return (
      <Button
        size="sm"
        variant="outline"
        type="button"
        disabled
        className="text-[10px]"
      >
        Adopted
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleAdopt}
        disabled={isPending}
      >
        {isPending ? "Adopting…" : "Adopt"}
      </Button>
      {error && (
        <span className="text-[10px] text-[color:var(--gw-color-risk)]">
          {error}
        </span>
      )}
    </div>
  );
}
