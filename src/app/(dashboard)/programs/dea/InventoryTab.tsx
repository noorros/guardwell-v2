"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { NewInventoryForm } from "./NewInventoryForm";

export interface InventoryTabProps {
  canManage: boolean;
  currentUserId: string;
  inventories: Array<{
    id: string;
    asOfDate: string;
    conductedByUserId: string;
    witnessUserId: string | null;
    notes: string | null;
    itemCount: number;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function notesPreview(notes: string | null): string {
  if (!notes) return "—";
  return notes.length > 60 ? `${notes.slice(0, 60)}…` : notes;
}

// ── InventoryTab ──────────────────────────────────────────────────────────────

export function InventoryTab({
  canManage,
  inventories,
}: InventoryTabProps) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Past inventories</h2>
        {inventories.length > 0 ? (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    As-of date
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Items
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                    Notes
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                    PDF
                  </th>
                </tr>
              </thead>
              <tbody>
                {inventories.map((inv, i) => (
                  <tr
                    key={inv.id}
                    className={cn(
                      "border-t",
                      i % 2 === 0 ? "bg-background" : "bg-muted/20",
                    )}
                  >
                    <td className="px-4 py-2.5 tabular-nums">
                      {fmtDate(inv.asOfDate)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {inv.itemCount}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                      {notesPreview(inv.notes)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/audit/dea-inventory?inventoryId=${inv.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <FileText className="h-3 w-3" aria-hidden="true" />
                        Download PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center">
            No inventories recorded yet.
          </p>
        )}
      </section>

      {canManage && <NewInventoryForm />}
    </div>
  );
}
