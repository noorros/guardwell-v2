// src/app/accept-invite/[token]/AcceptInvitationButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "./actions";

export function AcceptInvitationButton({
  token,
  invitationId,
}: {
  token: string;
  invitationId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        await acceptInvitationAction({ token, invitationId });
        router.push("/dashboard" as Route);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Accept failed");
      }
    });
  };

  return (
    <div className="space-y-1">
      <Button size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Accepting…" : "Accept invitation"}
      </Button>
      {error && (
        <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
      )}
    </div>
  );
}
