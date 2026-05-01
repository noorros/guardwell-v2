// src/lib/risk/capStatus.ts
//
// Phase 5 — derives effective CAP status. The stored CapStatus column
// only knows PENDING / IN_PROGRESS / COMPLETED; OVERDUE is computed from
// dueDate vs. now. This keeps the lifecycle audit clean (no cron flips
// status to OVERDUE then back to PENDING when due-date is extended).

import type { CapStatus, EffectiveCapStatus } from "./types";

export function effectiveCapStatus(
  status: CapStatus,
  dueDate: Date | null,
  now: Date = new Date(),
): EffectiveCapStatus {
  if (status === "COMPLETED") return "COMPLETED";
  if (dueDate && dueDate.getTime() < now.getTime()) return "OVERDUE";
  return status;
}
