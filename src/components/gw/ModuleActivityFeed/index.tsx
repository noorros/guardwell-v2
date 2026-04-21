// src/components/gw/ModuleActivityFeed/index.tsx
"use client";

import { Clock, Check, AlertTriangle, Circle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/gw/EmptyState";
import { cn } from "@/lib/utils";
import type { AiReasonSource } from "@/components/gw/ChecklistItem/AiReasonIndicator";

export type ActivityStatus =
  | "COMPLIANT"
  | "GAP"
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "NOT_APPLICABLE";

export interface ModuleActivityEvent {
  id: string;
  createdAt: Date;
  requirementTitle: string;
  nextStatus: ActivityStatus;
  actorUserId: string | null;
  actorEmail: string | null;
  source: AiReasonSource;
  reason: string | null;
}

export interface ModuleActivityFeedProps {
  events: ModuleActivityEvent[];
  currentUserId: string;
  distinctActorCount: number;
  className?: string;
}

const STATUS_META: Record<
  ActivityStatus,
  { label: string; Icon: LucideIcon; tone: string }
> = {
  COMPLIANT: {
    label: "Compliant",
    Icon: Check,
    tone: "border-[color:var(--gw-color-compliant)] bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_15%,transparent)] text-[color:var(--gw-color-compliant)]",
  },
  GAP: {
    label: "Gap",
    Icon: AlertTriangle,
    tone: "border-[color:var(--gw-color-risk)] bg-[color:color-mix(in_oklch,var(--gw-color-risk)_15%,transparent)] text-[color:var(--gw-color-risk)]",
  },
  NOT_STARTED: {
    label: "Not started",
    Icon: Circle,
    tone: "border-border bg-muted text-muted-foreground",
  },
  IN_PROGRESS: {
    label: "In progress",
    Icon: Clock,
    tone: "border-[color:var(--gw-color-needs)] bg-[color:color-mix(in_oklch,var(--gw-color-needs)_15%,transparent)] text-[color:var(--gw-color-needs)]",
  },
  NOT_APPLICABLE: {
    label: "N/A",
    Icon: Circle,
    tone: "border-border bg-muted text-muted-foreground",
  },
};

function resolveActorLabel(
  evt: ModuleActivityEvent,
  currentUserId: string,
): string | null {
  if (evt.actorUserId) {
    return evt.actorUserId === currentUserId
      ? "You"
      : (evt.actorEmail ?? "Unknown user");
  }
  // No human actor — distinguish AI from other system events.
  if (evt.source === "AI_ASSESSMENT") return "AI";
  return "System";
}

export function ModuleActivityFeed({
  events,
  currentUserId,
  distinctActorCount,
  className,
}: ModuleActivityFeedProps) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="No activity yet."
        className={className}
      />
    );
  }

  // When the feed has only one distinct actor (or none), showing "Changed by
  // <name>" on every row is noise — hide the actor entirely and just show the
  // relative time.
  const hideActor = distinctActorCount <= 1;

  return (
    <ul className={cn("space-y-3", className)}>
      {events.map((evt) => {
        const meta = STATUS_META[evt.nextStatus];
        const Icon = meta.Icon;
        const actorLabel = hideActor
          ? null
          : resolveActorLabel(evt, currentUserId);
        const relative = formatDistanceToNow(evt.createdAt, { addSuffix: true });
        return (
          <li
            key={evt.id}
            className="rounded-lg border bg-card p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm font-medium text-foreground">
                {evt.requirementTitle}
              </p>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
                  meta.tone,
                )}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                {meta.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {actorLabel ? (
                <>
                  Changed by {actorLabel}
                  {" • "}
                </>
              ) : null}
              <time dateTime={evt.createdAt.toISOString()}>{relative}</time>
            </p>
            {evt.reason && (
              <p className="mt-1 text-xs text-muted-foreground">{evt.reason}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
