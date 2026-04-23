// src/app/(dashboard)/programs/security-assets/RetireAssetButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { retireTechAssetAction } from "./actions";

export function RetireAssetButton({ techAssetId }: { techAssetId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRetire = () => {
    setError(null);
    startTransition(async () => {
      try {
        await retireTechAssetAction({ techAssetId });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to retire asset.");
      }
    });
  };

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-[10px] text-muted-foreground"
        onClick={() => setConfirming(true)}
      >
        Retire
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        className="text-[10px]"
        onClick={() => setConfirming(false)}
        disabled={isPending}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        className="text-[10px]"
        onClick={handleRetire}
        disabled={isPending}
      >
        {isPending ? "Retiring…" : "Confirm"}
      </Button>
      {error && (
        <span className="text-[10px] text-[color:var(--gw-color-risk)]">
          {error}
        </span>
      )}
    </div>
  );
}
