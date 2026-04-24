// src/app/(dashboard)/modules/[code]/ChecklistItemServer.tsx
"use client";

import { useTransition, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChecklistItem, type ChecklistStatus } from "@/components/gw/ChecklistItem";
import {
  AiReasonIndicator,
  type AiReasonSource,
} from "@/components/gw/ChecklistItem/AiReasonIndicator";
import { updateRequirementStatusAction } from "./actions";
import { RequirementAiHelp } from "./RequirementAiHelp";

type SpecialtyCategory =
  | "PRIMARY_CARE"
  | "SPECIALTY"
  | "DENTAL"
  | "BEHAVIORAL"
  | "ALLIED"
  | "OTHER";

export function ChecklistItemServer(props: {
  frameworkCode: string;
  requirementId: string;
  requirementCode: string;
  title: string;
  description?: string;
  /** State codes this requirement applies to. Empty = federal. */
  jurisdictionFilter?: string[];
  initialStatus: ChecklistStatus;
  lastEventSource?: AiReasonSource | null;
  lastEventReason?: string | null;
  /** Practice state — passed through to the AI helper for context. */
  practiceState?: string;
  practiceSpecialty?: SpecialtyCategory | null;
}) {
  const [status, setStatus] = useState<ChecklistStatus>(props.initialStatus);
  const [isPending, startTransition] = useTransition();
  const states = props.jurisdictionFilter ?? [];
  // Title renders with a leading state-chip when the requirement is a
  // state overlay, so users can tell which obligations are federal vs.
  // which kick in only because of the practice's primaryState / operatingStates.
  const titleNode = states.length > 0 ? (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {states.map((s) => (
        <Badge
          key={s}
          variant="outline"
          className="border-[color:var(--gw-color-setup)] bg-[color:color-mix(in_oklch,var(--gw-color-setup)_10%,transparent)] px-1.5 py-0 text-[10px] font-semibold uppercase text-[color:var(--gw-color-setup)]"
        >
          {s}
        </Badge>
      ))}
      <span>{props.title}</span>
    </span>
  ) : (
    props.title
  );

  return (
    <div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ChecklistItem
            title={titleNode}
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
      <div className="ml-7 mt-1">
        <RequirementAiHelp
          frameworkCode={props.frameworkCode}
          requirementCode={props.requirementCode}
          requirementTitle={props.title}
          requirementDescription={props.description}
          currentStatus={ciStatusFromChecklist(status)}
          practiceState={props.practiceState}
          specialty={props.practiceSpecialty}
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

function ciStatusFromChecklist(
  s: ChecklistStatus,
):
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLIANT"
  | "GAP"
  | "NOT_APPLICABLE" {
  if (s === "compliant") return "COMPLIANT";
  if (s === "gap") return "GAP";
  return "NOT_STARTED";
}
