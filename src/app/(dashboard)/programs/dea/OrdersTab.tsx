"use client";

import { cn } from "@/lib/utils";
import { SCHEDULE_LABELS, type DeaSchedule } from "@/lib/dea/labels";
import { NewOrderForm } from "./NewOrderForm";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

export interface OrdersTabProps {
  canManage: boolean;
  orders: Array<{
    id: string;
    orderedAt: string;
    receivedAt: string | null;
    supplierName: string;
    form222Number: string | null;
    drugName: string;
    schedule: string;
    quantity: number;
    unit: string;
  }>;
}

function scheduleLabel(s: string): string {
  return SCHEDULE_LABELS[s as DeaSchedule] ?? s;
}

export function OrdersTab({ canManage, orders }: OrdersTabProps) {
  const tz = usePracticeTimezone();
  const fmtDate = (iso: string) => formatPracticeDate(new Date(iso), tz);
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Recent orders</h2>
        {orders.length > 0 ? (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Ordered
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Supplier
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                    Form 222 #
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
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr
                    key={o.id}
                    className={cn(
                      "border-t",
                      i % 2 === 0 ? "bg-background" : "bg-muted/20",
                    )}
                  >
                    <td className="px-4 py-2.5 tabular-nums">
                      {fmtDate(o.orderedAt)}
                    </td>
                    <td className="px-4 py-2.5">{o.supplierName}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums hidden sm:table-cell">
                      {o.form222Number ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">{o.drugName}</td>
                    <td className="px-4 py-2.5 text-xs hidden sm:table-cell">
                      {scheduleLabel(o.schedule)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {o.quantity.toLocaleString("en-US")} {o.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center">
            No orders recorded yet.
          </p>
        )}
      </section>

      {canManage && <NewOrderForm />}
    </div>
  );
}
