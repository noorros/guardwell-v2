// src/app/(dashboard)/programs/vendors/VendorActions.tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markBaaExecutedAction, removeVendorAction } from "./actions";

export interface VendorActionsProps {
  vendorId: string;
  processesPhi: boolean;
  hasBaa: boolean;
}

export function VendorActions({
  vendorId,
  processesPhi,
  hasBaa,
}: VendorActionsProps) {
  const [isPending, startTransition] = useTransition();

  const handleMarkBaa = () => {
    startTransition(async () => {
      try {
        await markBaaExecutedAction({ vendorId });
      } catch (err) {
        console.error("markBaaExecutedAction failed", err);
      }
    });
  };

  const handleRemove = () => {
    startTransition(async () => {
      try {
        await removeVendorAction({ vendorId });
      } catch (err) {
        console.error("removeVendorAction failed", err);
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {processesPhi && !hasBaa && (
        <Button size="sm" onClick={handleMarkBaa} disabled={isPending}>
          {isPending ? "Saving…" : "Mark BAA signed"}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={handleRemove}
        disabled={isPending}
      >
        Remove
      </Button>
    </div>
  );
}
