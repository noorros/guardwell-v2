// src/app/(dashboard)/modules/[code]/ChecklistItemServer.tsx
"use client";

import { useTransition, useState } from "react";
import { ChecklistItem, type ChecklistStatus } from "@/components/gw/ChecklistItem";
import {
  AiReasonIndicator,
  type AiReasonSource,
} from "@/components/gw/ChecklistItem/AiReasonIndicator";
import { updateRequirementStatusAction } from "./actions";

export function ChecklistItemServer(props: {
  frameworkCode: string;
  requirementId: string;
  requirementCode: string;
  title: string;
  description?: string;
  initialStatus: ChecklistStatus;
  lastEventSource?: AiReasonSource | null;
  lastEventReason?: string | null;
}) {
  const [status, setStatus] = useState<ChecklistStatus>(props.initialStatus);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
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
      </div>
      <div className="pt-4">
        <AiReasonIndicator
          source={props.lastEventSource ?? null}
          reason={props.lastEventReason ?? null}
        />
      </div>
    </div>
  );
}

function checklistToCiStatus(
  s: ChecklistStatus,
): "COMPLIANT" | "GAP" | "NOT_STARTED" {
  if (s === "compliant") return "COMPLIANT";
  if (s === "gap") return "GAP";
  return "NOT_STARTED";
}
