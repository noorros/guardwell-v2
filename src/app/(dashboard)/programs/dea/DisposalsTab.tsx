"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCHEDULE_LABELS, type DeaSchedule } from "@/lib/dea/labels";
import { NewDisposalForm } from "./NewDisposalForm";

export interface DisposalsTabProps {
  canManage: boolean;
  disposals: Array<{
    id: string;
    disposalDate: string;
    reverseDistributorName: string;
    disposalMethod: string;
    drugName: string;
    schedule: string;
    quantity: number;
    unit: string;
    form41Filed: boolean;
  }>;
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function scheduleLabel(s: string): string {
  return SCHEDULE_LABELS[s as DeaSchedule] ?? s;
}

export function DisposalsTab({ canManage, disposals }: DisposalsTabProps) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Recent disposals</h2>
        {disposals.length > 0 ? (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Date
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Reverse distributor
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Drug
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                    Schedule
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                    Quantity
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                    Form 41
                  </th>
                </tr>
              </thead>
              <tbody>
                {disposals.map((d, i) => (
                  <tr
                    key={d.id}
                    className={cn(
                      "border-t",
                      i % 2 === 0 ? "bg-background" : "bg-muted/20",
                    )}
                  >
                    <td className="px-4 py-2.5 tabular-nums">
                      {fmtDate(d.disposalDate)}
                    </td>
                    <td className="px-4 py-2.5">{d.reverseDistributorName}</td>
                    <td className="px-4 py-2.5">{d.drugName}</td>
                    <td className="px-4 py-2.5 text-xs hidden sm:table-cell">
                      {scheduleLabel(d.schedule)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {d.quantity.toLocaleString("en-US")} {d.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/audit/dea-form-41/${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <FileText className="h-3 w-3" aria-hidden="true" />
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center">
            No disposals recorded yet.
          </p>
        )}
      </section>

      {canManage && <NewDisposalForm />}
    </div>
  );
}
