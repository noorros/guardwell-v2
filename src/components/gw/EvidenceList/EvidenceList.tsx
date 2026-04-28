"use client";
// src/components/gw/EvidenceList/EvidenceList.tsx
//
// Read-only (with optional delete) file list. Consumes evidence items as
// props — the caller is responsible for fetching and refreshing. This
// separation keeps <EvidenceUploader> and <EvidenceList> independently
// usable on any surface.

import { useState, useTransition } from "react";
import { Download, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EvidenceListItem {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string; // ISO string
  status: "PENDING" | "UPLOADED" | "DELETED";
}

export interface EvidenceListProps {
  items: EvidenceListItem[];
  /**
   * Whether the current user may delete evidence.
   * Pass true only when the user has OWNER or ADMIN role.
   */
  canDelete: boolean;
  /** Called with the evidenceId after a successful delete so the caller can refresh. */
  onDeleted: (evidenceId: string) => void;
}

export function EvidenceList({ items, canDelete, onDeleted }: EvidenceListProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeItems = items.filter((i) => i.status !== "DELETED");

  const handleDelete = (id: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/evidence/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const { error: e } = (await res.json()) as { error?: string };
          throw new Error(e ?? "Delete failed");
        }
        onDeleted(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  };

  if (activeItems.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No files attached yet.</p>
    );
  }

  return (
    <div className="space-y-1">
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <ul className="divide-y rounded-md border text-xs">
        {activeItems.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-3 py-2">
            <FileText
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="flex-1 truncate" title={item.fileName}>
              {item.fileName}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {Math.round(item.fileSizeBytes / 1024)} KB
            </span>
            {item.status === "PENDING" && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                pending
              </span>
            )}
            <a
              href={`/api/evidence/${item.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded p-1 hover:bg-accent"
              aria-label={`Download ${item.fileName}`}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => handleDelete(item.id)}
                disabled={isPending}
                aria-label={`Delete ${item.fileName}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
