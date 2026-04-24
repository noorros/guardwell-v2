// src/app/(dashboard)/programs/cybersecurity/MfaToggle.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { recordMfaEnrollmentAction } from "./actions";

export interface MfaToggleProps {
  practiceUserId: string;
  enrolled: boolean;
  userLabel: string;
}

export function MfaToggle({ practiceUserId, enrolled, userLabel }: MfaToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleToggle = () => {
    setError(null);
    startTransition(async () => {
      try {
        await recordMfaEnrollmentAction({
          practiceUserId,
          enrolled: !enrolled,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={enrolled ? "outline" : "default"}
        onClick={handleToggle}
        disabled={isPending}
        aria-label={`${enrolled ? "Mark unenrolled" : "Mark enrolled"} for ${userLabel}`}
      >
        {isPending
          ? "Saving…"
          : enrolled
            ? "Mark unenrolled"
            : "Mark enrolled"}
      </Button>
      {error && (
        <span className="text-[10px] text-[color:var(--gw-color-risk)]">
          {error}
        </span>
      )}
    </div>
  );
}
