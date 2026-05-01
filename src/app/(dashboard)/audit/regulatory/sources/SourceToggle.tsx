// src/app/(dashboard)/audit/regulatory/sources/SourceToggle.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toggleSourceAction } from "../actions";

export interface SourceToggleProps {
  sourceId: string;
  sourceName: string;
  isActive: boolean;
}

export function SourceToggle({
  sourceId,
  sourceName,
  isActive,
}: SourceToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleToggle = () => {
    setError(null);
    startTransition(async () => {
      const res = await toggleSourceAction({
        sourceId,
        isActive: !isActive,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={isActive ? "outline" : "default"}
        onClick={handleToggle}
        disabled={isPending}
        aria-label={`${isActive ? "Disable" : "Enable"} source ${sourceName}`}
      >
        {isPending ? "Saving..." : isActive ? "Disable" : "Enable"}
      </Button>
      {error && (
        <span
          role="alert"
          className="text-[10px] text-[color:var(--gw-color-risk)]"
        >
          {error}
        </span>
      )}
    </div>
  );
}
