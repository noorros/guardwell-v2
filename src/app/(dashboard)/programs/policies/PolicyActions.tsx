// src/app/(dashboard)/programs/policies/PolicyActions.tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { PolicyCode } from "@/lib/compliance/policies";
import { adoptPolicyAction, retirePolicyAction } from "./actions";

interface AdoptedState {
  practicePolicyId: string;
  adoptedAt: Date;
}

export interface PolicyActionsProps {
  policyCode: PolicyCode;
  adopted: AdoptedState | null;
}

export function PolicyActions({ policyCode, adopted }: PolicyActionsProps) {
  const [isPending, startTransition] = useTransition();

  const handleAdopt = () => {
    startTransition(async () => {
      try {
        await adoptPolicyAction({ policyCode });
      } catch (err) {
        console.error("adoptPolicyAction failed", err);
      }
    });
  };

  const handleRetire = () => {
    if (!adopted) return;
    startTransition(async () => {
      try {
        await retirePolicyAction({ practicePolicyId: adopted.practicePolicyId });
      } catch (err) {
        console.error("retirePolicyAction failed", err);
      }
    });
  };

  if (!adopted) {
    return (
      <Button size="sm" onClick={handleAdopt} disabled={isPending}>
        {isPending ? "Adopting…" : "Adopt"}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleRetire}
      disabled={isPending}
    >
      {isPending ? "Retiring…" : "Retire"}
    </Button>
  );
}
