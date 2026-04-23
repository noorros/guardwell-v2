// src/app/(dashboard)/programs/staff/RemoveMemberButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { removeMemberAction } from "./invitation-actions";

export function RemoveMemberButton({
  practiceUserId,
  memberLabel,
}: {
  practiceUserId: string;
  memberLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleRemove = () => {
    setError(null);
    startTransition(async () => {
      try {
        await removeMemberAction({ practiceUserId });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Remove failed");
      }
    });
  };

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-[color:var(--gw-color-risk)] hover:text-[color:var(--gw-color-risk)]"
        onClick={() => setConfirming(true)}
      >
        Remove
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <p className="text-[10px] text-muted-foreground">
        Remove {memberLabel}?
      </p>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={handleRemove} disabled={isPending}>
          {isPending ? "Removing…" : "Confirm"}
        </Button>
      </div>
      {error && (
        <p className="text-[10px] text-[color:var(--gw-color-risk)]">{error}</p>
      )}
    </div>
  );
}
