// src/app/(dashboard)/programs/staff/RevokeButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { revokeInvitationAction } from "./invitation-actions";

export function RevokeButton({ invitationId }: { invitationId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        await revokeInvitationAction({ invitationId });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Revoke failed");
      }
    });
  };

  return (
    <div className="flex flex-col items-end">
      <Button size="sm" variant="ghost" onClick={handleClick} disabled={isPending}>
        {isPending ? "Revoking…" : "Revoke"}
      </Button>
      {error && (
        <p className="text-[10px] text-[color:var(--gw-color-risk)]">{error}</p>
      )}
    </div>
  );
}
