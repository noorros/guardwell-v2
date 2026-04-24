// src/app/(dashboard)/programs/policies/PolicyActions.tsx
"use client";

import { useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import type { PolicyCode } from "@/lib/compliance/policies";
import {
  adoptPolicyAction,
  retirePolicyAction,
  reviewPolicyAction,
} from "./actions";

interface AdoptedState {
  practicePolicyId: string;
  adoptedAt: Date;
  /** ISO string; null when this policy has never been reviewed. */
  lastReviewedAt: string | null;
}

export interface PolicyActionsProps {
  policyCode: PolicyCode;
  adopted: AdoptedState | null;
}

const REVIEW_WINDOW_DAYS = 365;

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

  const handleReview = () => {
    if (!adopted) return;
    startTransition(async () => {
      try {
        await reviewPolicyAction({ practicePolicyId: adopted.practicePolicyId });
      } catch (err) {
        console.error("reviewPolicyAction failed", err);
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
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={`/programs/policies/${adopted.practicePolicyId}` as Route}>
          Edit
        </Link>
      </Button>
      <Button
        size="sm"
        variant="default"
        onClick={handleReview}
        disabled={isPending}
        title={
          adopted.lastReviewedAt
            ? `Last reviewed ${adopted.lastReviewedAt.slice(0, 10)}. Bumps the ${REVIEW_WINDOW_DAYS}-day clock.`
            : `Hasn't been formally reviewed yet. Bumps the ${REVIEW_WINDOW_DAYS}-day clock.`
        }
      >
        {isPending ? "Reviewing…" : "Mark reviewed"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={handleRetire}
        disabled={isPending}
      >
        {isPending ? "Retiring…" : "Retire"}
      </Button>
    </div>
  );
}
