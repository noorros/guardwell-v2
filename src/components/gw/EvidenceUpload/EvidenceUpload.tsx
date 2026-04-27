"use client";
// src/components/gw/EvidenceUpload/EvidenceUpload.tsx
//
// Reusable file-upload component. Three-step flow:
//   1. POST /api/evidence/upload (action: init) → signed PUT URL
//   2. PUT directly to GCS signed URL
//   3. POST /api/evidence/upload (action: confirm) → status → UPLOADED
//
// In dev (GCS unset) step 2 is skipped; the component shows a notice but
// still creates the Evidence row so the rest of the UI works.

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Download, FileText, Trash2, Upload } from "lucide-react";

export interface EvidenceItem {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string; // ISO string
  status: string;
}

export interface EvidenceUploadProps {
  entityType: string;
  entityId: string;
  initialEvidence?: EvidenceItem[];
  /** Called after each successful upload so the parent can refresh server data. */
  onUploaded?: () => void;
  /** Whether the current user can delete evidence. */
  canDelete?: boolean;
  /** Comma-separated MIME types (e.g. "application/pdf,image/png"). */
  accept?: string;
  /** Max file size in MB (default 25). */
  maxSizeMb?: number;
}

const DEFAULT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.heic,.webp";
const DEFAULT_MAX_MB = 25;

export function EvidenceUpload({
  entityType,
  entityId,
  initialEvidence = [],
  onUploaded,
  canDelete = true,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = DEFAULT_MAX_MB,
}: EvidenceUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<EvidenceItem[]>(initialEvidence);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [devNotice, setDevNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleFile = async (file: File) => {
    setError(null);
    setDevNotice(null);

    // Client-side size guard
    const maxBytes = maxSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      setError(`File too large — max ${maxSizeMb} MB.`);
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      // Step 1: request a signed upload URL
      const initRes = await fetch("/api/evidence/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "init",
          entityType,
          entityId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSizeBytes: file.size,
        }),
      });
      if (!initRes.ok) {
        const { error: e } = (await initRes.json()) as { error?: string };
        throw new Error(e ?? "Could not start upload");
      }
      const init = (await initRes.json()) as {
        evidenceId: string;
        gcsKey: string;
        uploadUrl: string | null;
        expiresInSec: number;
        reason?: string;
      };

      setProgress(20);

      if (!init.uploadUrl) {
        // Dev no-op mode — GCS bucket not configured
        setDevNotice(
          `GCS not configured (dev mode) — skipping file transfer. Evidence row created with PENDING status.`,
        );
      } else {
        // Step 2: PUT directly to GCS
        const putRes = await fetch(init.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`GCS upload failed: HTTP ${putRes.status}`);
        }
        setProgress(80);
      }

      // Step 3: confirm (flip status to UPLOADED, or keep PENDING in dev)
      if (init.uploadUrl) {
        const confirmRes = await fetch(`/api/evidence/${init.evidenceId}/confirm`, {
          method: "POST",
        });
        if (!confirmRes.ok) {
          const { error: e } = (await confirmRes.json()) as { error?: string };
          throw new Error(e ?? "Could not confirm upload");
        }
      }

      setProgress(100);

      const newItem: EvidenceItem = {
        id: init.evidenceId,
        fileName: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        status: init.uploadUrl ? "UPLOADED" : "PENDING",
      };
      setItems((prev) => [newItem, ...prev]);
      onUploaded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(0);
      // Reset the file input so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = (id: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/evidence/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const { error: e } = (await res.json()) as { error?: string };
          throw new Error(e ?? "Delete failed");
        }
        setItems((prev) => prev.filter((i) => i.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const activeItems = items.filter((i) => i.status !== "DELETED");

  return (
    <div className="space-y-3">
      {/* Drop zone / click to pick */}
      <div
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary hover:bg-accent/30"
        onClick={() => !uploading && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        aria-label="Upload file"
      >
        <Upload className="mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Drop a file here or <span className="text-primary underline">click to browse</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF, PNG, JPG, HEIC or WebP — up to {maxSizeMb} MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>
        </div>
      )}

      {/* Error / dev notice */}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {devNotice && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {devNotice}
        </p>
      )}

      {/* Evidence list */}
      {activeItems.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No files attached yet.
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-xs">
          {activeItems.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2">
              <FileText
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="flex-1 truncate" title={item.fileName}>
                {item.fileName}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {Math.round(item.fileSizeBytes / 1024)} KB
              </span>
              {item.status === "PENDING" && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
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
                <Download className="h-3.5 w-3.5" />
              </a>
              {canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => handleDelete(item.id)}
                  disabled={isPending || uploading}
                  aria-label={`Delete ${item.fileName}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
