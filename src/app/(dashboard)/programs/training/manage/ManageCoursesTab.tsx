// src/app/(dashboard)/programs/training/manage/ManageCoursesTab.tsx
//
// Phase 4 PR 4 — client component that renders the Manage Courses
// table. Each row carries:
//
//   - Title + the course type pill
//   - Version (informational; bumped by edits via the upcoming PR)
//   - Status (Active / Retired) — derived from sortOrder===9999
//   - Actions (em-dash for system rows; Retire/Restore for custom rows)
//
// The "Create course" button at the top opens a Dialog hosting the
// CreateCourseForm. After a successful create/retire/restore, we
// router.refresh() to re-fetch the server-rendered table — the
// underlying server actions also call revalidatePath so any other open
// /programs/training surface updates too.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  retireTrainingCourseAction,
  restoreTrainingCourseAction,
} from "../actions";
import { CreateCourseForm } from "./CreateCourseForm";
import type { ManageCourseRow } from "./page";

export interface ManageCoursesTabProps {
  rows: ManageCourseRow[];
}

export function ManageCoursesTab({ rows }: ManageCoursesTabProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingId, startTransition] = usePendingId();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function runLifecycle(
    id: string,
    action: (input: { courseId: string }) => Promise<{ courseId: string }>,
  ) {
    setErrorMsg(null);
    startTransition(id, async () => {
      try {
        await action({ courseId: id });
        router.refresh();
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : "Action failed",
        );
      }
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "course" : "courses"}
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button type="button" size="sm">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Create course
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create custom course</DialogTitle>
            </DialogHeader>
            <CreateCourseForm
              onSuccess={() => {
                setCreateOpen(false);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {errorMsg}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">
          No courses in the catalog yet. Click &quot;Create course&quot; to add
          one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Title
                </th>
                <th scope="col" className="px-3 py-2">
                  Type
                </th>
                <th scope="col" className="px-3 py-2">
                  Version
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const isPending = pendingId === row.id;
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-medium text-foreground">
                      {row.title}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {row.type}
                      </Badge>
                      {row.isCustom && (
                        <Badge
                          variant="outline"
                          className="ml-1 text-[10px]"
                        >
                          Custom
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      v{row.version}
                    </td>
                    <td className="px-3 py-2">
                      {row.isRetired ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-muted-foreground"
                        >
                          Retired
                        </Badge>
                      ) : (
                        <Badge
                          variant="default"
                          className="text-[10px]"
                        >
                          Active
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.isCustom ? (
                        row.isRetired ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={isPending}
                            onClick={() =>
                              runLifecycle(
                                row.id,
                                restoreTrainingCourseAction,
                              )
                            }
                          >
                            {isPending ? "…" : "Restore"}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={isPending}
                            onClick={() =>
                              runLifecycle(
                                row.id,
                                retireTrainingCourseAction,
                              )
                            }
                          >
                            {isPending ? "…" : "Retire"}
                          </Button>
                        )
                      ) : (
                        <span aria-hidden="true">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Tracks which course id (if any) is currently mid-action so the row's
 * Retire/Restore button can render a busy state without affecting other
 * rows. React's useTransition() doesn't expose a per-action discriminator
 * out of the box, so we wrap it.
 */
function usePendingId(): [
  string | null,
  (id: string, fn: () => Promise<void>) => void,
] {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function start(id: string, fn: () => Promise<void>) {
    setPendingId(id);
    startTransition(async () => {
      try {
        await fn();
      } finally {
        setPendingId(null);
      }
    });
  }

  return [pendingId, start];
}
