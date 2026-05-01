// src/app/(dashboard)/programs/risk/CapTab.tsx
//
// Phase 5 PR 6 — CAP timeline tab. Receives a list of CorrectiveAction
// rows from the parent /programs/risk page and renders them in the
// register's "card per row" idiom. OVERDUE is derived via
// effectiveCapStatus(); the stored status column never holds OVERDUE.
//
// Sort order: OVERDUE first (most-urgent), then IN_PROGRESS, then PENDING
// by dueDate asc (earliest due first), then COMPLETED last. Within a
// group, due-date asc; rows without a dueDate sink to the bottom of
// their group, ordered by createdAt desc.

"use client";

import Link from "next/link";
import type { Route } from "next";
import type { CorrectiveAction } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { effectiveCapStatus } from "@/lib/risk/capStatus";
import type { CapStatus, EffectiveCapStatus } from "@/lib/risk/types";

export interface CapTabProps {
  caps: Array<
    Pick<
      CorrectiveAction,
      | "id"
      | "description"
      | "status"
      | "dueDate"
      | "createdAt"
      | "ownerUserId"
      | "riskItemId"
      | "sourceAlertId"
    >
  >;
}

function statusBadgeVariant(
  s: EffectiveCapStatus,
): "default" | "destructive" | "secondary" {
  if (s === "OVERDUE") return "destructive";
  if (s === "COMPLETED") return "secondary";
  if (s === "IN_PROGRESS") return "default";
  // PENDING
  return "secondary";
}

function statusLabel(s: EffectiveCapStatus): string {
  // "IN_PROGRESS" → "In progress", "OVERDUE" → "Overdue", etc.
  return s[0] + s.slice(1).toLowerCase().replace("_", " ");
}

export function CapTab({ caps }: CapTabProps) {
  if (caps.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No corrective actions yet. CAPs are created from open risks or
          regulatory alerts.
        </CardContent>
      </Card>
    );
  }

  // Sort by effective status group → dueDate asc → createdAt desc.
  const sorted = [...caps].sort((a, b) => {
    const sa = effectiveCapStatus(a.status as CapStatus, a.dueDate);
    const sb = effectiveCapStatus(b.status as CapStatus, b.dueDate);
    const order: Record<EffectiveCapStatus, number> = {
      OVERDUE: 0,
      IN_PROGRESS: 1,
      PENDING: 2,
      COMPLETED: 3,
    };
    if (order[sa] !== order[sb]) return order[sa] - order[sb];
    if (a.dueDate && b.dueDate) {
      return a.dueDate.getTime() - b.dueDate.getTime();
    }
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return (
    <div className="space-y-2">
      {sorted.map((c) => {
        const eff = effectiveCapStatus(c.status as CapStatus, c.dueDate);
        return (
          <Card key={c.id}>
            <CardContent className="p-4">
              <Link
                href={`/programs/risk/cap/${c.id}` as Route}
                className="block hover:underline"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {c.description.slice(0, 200)}
                    </p>
                    {c.dueDate && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Due {c.dueDate.toLocaleDateString()}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.riskItemId
                        ? "Linked to risk"
                        : c.sourceAlertId
                          ? "From regulatory alert"
                          : "Standalone"}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant(eff)}>
                    {statusLabel(eff)}
                  </Badge>
                </div>
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
