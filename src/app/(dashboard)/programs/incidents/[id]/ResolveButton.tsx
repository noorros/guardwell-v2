// src/app/(dashboard)/programs/incidents/[id]/ResolveButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resolveIncidentAction } from "../actions";

export function ResolveButton({ incidentId }: { incidentId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        await resolveIncidentAction({ incidentId, resolution: null });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Resolution failed");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Resolving…" : "Mark resolved"}
      </Button>
      {error && (
        <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
      )}
    </div>
  );
}
