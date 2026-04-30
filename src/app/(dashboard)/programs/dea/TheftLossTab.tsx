"use client";

import { FileText, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SCHEDULE_LABELS,
  LOSS_TYPE_LABELS,
  type DeaSchedule,
} from "@/lib/dea/labels";
import { NewTheftLossForm } from "./NewTheftLossForm";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

export interface TheftLossTabProps {
  canManage: boolean;
  reports: Array<{
    id: string;
    discoveredAt: string;
    lossType: string;
    drugName: string;
    schedule: string;
    quantityLost: number;
    unit: string;
    form106SubmittedAt: string | null;
  }>;
}

function scheduleLabel(s: string): string {
  return SCHEDULE_LABELS[s as DeaSchedule] ?? s;
}

function lossTypeLabel(lt: string): string {
  return LOSS_TYPE_LABELS[lt] ?? lt;
}

export function TheftLossTab({ canManage, reports }: TheftLossTabProps) {
  const tz = usePracticeTimezone();
  const fmtDate = (iso: string) => formatPracticeDate(new Date(iso), tz);
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Recent theft / loss reports</h2>
        {reports.length > 0 ? (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Date discovered
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Loss type
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Drug
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                    Schedule
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                    Quantity lost
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                    Form 106
                  </th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r, i) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-t",
                      i % 2 === 0 ? "bg-background" : "bg-muted/20",
                    )}
                  >
                    <td className="px-4 py-2.5 tabular-nums">
                      {fmtDate(r.discoveredAt)}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {lossTypeLabel(r.lossType)}
                    </td>
                    <td className="px-4 py-2.5">{r.drugName}</td>
                    <td className="px-4 py-2.5 text-xs hidden sm:table-cell">
                      {scheduleLabel(r.schedule)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.quantityLost.toLocaleString("en-US")} {r.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {r.form106SubmittedAt ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[color:var(--gw-color-compliant)]">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            Filed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            Pending
                          </span>
                        )}
                        <a
                          href={`/api/audit/dea-form-106/${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <FileText className="h-3 w-3" aria-hidden="true" />
                          PDF
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center">
            No theft / loss reports recorded yet.
          </p>
        )}
      </section>

      {canManage && <NewTheftLossForm />}
    </div>
  );
}
