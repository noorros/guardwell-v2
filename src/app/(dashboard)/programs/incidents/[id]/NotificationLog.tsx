// src/app/(dashboard)/programs/incidents/[id]/NotificationLog.tsx
//
// Post-determination notification tracker. One row per notification audience
// (HHS, affected individuals, media, state AG). Each row: a button while
// pending, the recorded timestamp once notified.
//
// Click → recordIncidentNotificationAction({ kind, incidentId }) which
// appends the corresponding event + projection writes the timestamp +
// rederives any state-overlay rule keyed off that evidence type
// (e.g. CA's 15-business-day rule reads affectedIndividualsNotifiedAt).

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { recordIncidentNotificationAction } from "../actions";

type Kind = "HHS" | "AFFECTED_INDIVIDUALS" | "MEDIA" | "STATE_AG";

interface NotificationRow {
  kind: Kind;
  label: string;
  helper: string;
  notifiedAt: string | null;
  required: boolean;
}

export function NotificationLog({
  incidentId,
  affectedCount,
  ocrNotifiedAtIso,
  affectedIndividualsNotifiedAtIso,
  mediaNotifiedAtIso,
  stateAgNotifiedAtIso,
  defaultStateCode,
}: {
  incidentId: string;
  affectedCount: number;
  ocrNotifiedAtIso: string | null;
  affectedIndividualsNotifiedAtIso: string | null;
  mediaNotifiedAtIso: string | null;
  stateAgNotifiedAtIso: string | null;
  defaultStateCode: string;
}) {
  const isMajor = affectedCount >= 500;
  const rows: NotificationRow[] = [
    {
      kind: "HHS",
      label: "HHS Office for Civil Rights",
      helper: isMajor
        ? "Required within 60 days of discovery (immediate-portal submission for 500+ affected)."
        : "Required within 60 days of the end of the calendar year of discovery.",
      notifiedAt: ocrNotifiedAtIso,
      required: true,
    },
    {
      kind: "AFFECTED_INDIVIDUALS",
      label: "Affected individuals",
      helper:
        "Required without unreasonable delay and no later than 60 days from discovery. State overlays (e.g. CA 15 business days) may require sooner.",
      notifiedAt: affectedIndividualsNotifiedAtIso,
      required: true,
    },
    {
      kind: "MEDIA",
      label: "Prominent media outlet",
      helper:
        "Required when the breach affects more than 500 residents of a single state or jurisdiction. Newspaper, TV, or radio appropriate to the area.",
      notifiedAt: mediaNotifiedAtIso,
      required: isMajor,
    },
    {
      kind: "STATE_AG",
      label: `State AG (${defaultStateCode})`,
      helper:
        "Many state breach laws require AG notice in addition to HHS — thresholds vary (e.g. TX 250+, FL 500+, NY any breach). Confirm state-specific rules.",
      notifiedAt: stateAgNotifiedAtIso,
      required: false,
    },
  ];

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div>
          <h2 className="text-sm font-semibold">Notification log</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Record each external notification as it goes out. Timestamps feed
            state-overlay rules — e.g. logging affected-individual notice
            within 15 business days flips California&apos;s overlay to
            COMPLIANT automatically.
          </p>
        </div>
        <ul className="divide-y rounded-md border">
          {rows.map((row) => (
            <NotificationLogRow
              key={row.kind}
              incidentId={incidentId}
              defaultStateCode={defaultStateCode}
              row={row}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function NotificationLogRow({
  incidentId,
  defaultStateCode,
  row,
}: {
  incidentId: string;
  defaultStateCode: string;
  row: NotificationRow;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        await recordIncidentNotificationAction({
          incidentId,
          kind: row.kind,
          ...(row.kind === "STATE_AG"
            ? { stateCode: defaultStateCode }
            : {}),
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-foreground">{row.label}</p>
          {row.required && (
            <span className="text-[9px] uppercase tracking-wider text-[color:var(--gw-color-risk)]">
              Required
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">{row.helper}</p>
        {error && (
          <p className="text-[10px] text-[color:var(--gw-color-risk)]">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {row.notifiedAt ? (
          <p
            className="text-[11px] font-medium text-[color:var(--gw-color-compliant)]"
            title={row.notifiedAt}
          >
            Notified {row.notifiedAt.slice(0, 10)}
          </p>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={handleClick}
            disabled={isPending}
          >
            {isPending ? "Recording…" : "Record notification"}
          </Button>
        )}
      </div>
    </li>
  );
}
