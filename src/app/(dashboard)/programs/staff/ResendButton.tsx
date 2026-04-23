// src/app/(dashboard)/programs/staff/ResendButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resendInvitationAction } from "./invitation-actions";

export function ResendButton({ invitationId }: { invitationId: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await resendInvitationAction({ invitationId });
        setNotice(
          res.emailDelivered
            ? "Re-sent. New link expires in 7 days."
            : `New link generated (email: ${res.emailReason ?? "no provider"}).`,
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Resend failed");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={handleClick} disabled={isPending}>
        {isPending ? "Resending…" : "Resend"}
      </Button>
      {notice && (
        <p className="text-[10px] text-[color:var(--gw-color-compliant)]">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-[10px] text-[color:var(--gw-color-risk)]">{error}</p>
      )}
    </div>
  );
}
