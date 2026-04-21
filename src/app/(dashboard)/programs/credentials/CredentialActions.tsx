// src/app/(dashboard)/programs/credentials/CredentialActions.tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { removeCredentialAction } from "./actions";

export interface CredentialActionsProps {
  credentialId: string;
}

export function CredentialActions({ credentialId }: CredentialActionsProps) {
  const [isPending, startTransition] = useTransition();

  const handleRemove = () => {
    startTransition(async () => {
      try {
        await removeCredentialAction({ credentialId });
      } catch (err) {
        console.error("removeCredentialAction failed", err);
      }
    });
  };

  return (
    <Button size="sm" variant="ghost" onClick={handleRemove} disabled={isPending}>
      Remove
    </Button>
  );
}
