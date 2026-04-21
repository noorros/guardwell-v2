// src/app/(dashboard)/modules/[code]/ChecklistItemServer.tsx
"use client";

import { useTransition, useState } from "react";
import { ChecklistItem, type ChecklistStatus } from "@/components/gw/ChecklistItem";
import { updateRequirementStatusAction } from "./actions";

export function ChecklistItemServer(props: {
  frameworkCode: string;
  requirementId: string;
  requirementCode: string;
  title: string;
  description?: string;
  initialStatus: ChecklistStatus;
}) {
  const [status, setStatus] = useState<ChecklistStatus>(props.initialStatus);
  const [isPending, startTransition] = useTransition();

  return (
    <ChecklistItem
      title={props.title}
      description={props.description}
      status={status}
      disabled={isPending}
      onStatusChange={(next) => {
        const prev = status;
        setStatus(next);
        startTransition(async () => {
          try {
            await updateRequirementStatusAction({
              frameworkCode: props.frameworkCode,
              requirementId: props.requirementId,
              requirementCode: props.requirementCode,
              nextStatus: checklistToCiStatus(next),
              previousStatus: checklistToCiStatus(prev),
            });
          } catch (err) {
            // Revert on server failure.
            setStatus(prev);
            console.error(err);
          }
        });
      }}
    />
  );
}

function checklistToCiStatus(
  s: ChecklistStatus,
): "COMPLIANT" | "GAP" | "NOT_STARTED" {
  if (s === "compliant") return "COMPLIANT";
  if (s === "gap") return "GAP";
  return "NOT_STARTED";
}
