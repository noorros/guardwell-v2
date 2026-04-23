// src/app/(dashboard)/settings/notifications/RunDigestNowButton.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { runDigestNowAction } from "./actions";

export function RunDigestNowButton() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await runDigestNowAction();
        setNotice(
          `Scanned ${res.practicesScanned} practice${
            res.practicesScanned === 1 ? "" : "s"
          }, created ${res.notificationsCreated} notification${
            res.notificationsCreated === 1 ? "" : "s"
          }, sent ${res.emailsDelivered} email${
            res.emailsDelivered === 1 ? "" : "s"
          }.`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Run failed");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Running…" : "Run digest"}
      </Button>
      {notice && (
        <p className="max-w-[240px] text-right text-[10px] text-[color:var(--gw-color-compliant)]">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-[10px] text-[color:var(--gw-color-risk)]">{error}</p>
      )}
    </div>
  );
}
