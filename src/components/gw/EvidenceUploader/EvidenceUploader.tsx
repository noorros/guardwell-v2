"use client";
// src/components/gw/EvidenceUploader/EvidenceUploader.tsx
//
// Upload-only half of the evidence upload flow. Handles drag-drop + click-
// to-pick, three-step signed-URL flow, progress bar, error states.
// Renders nothing after a successful upload — the caller is expected to
// refresh the <EvidenceList> (e.g. via router.refresh() or state update).

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EvidenceUploaderProps {
  entityType: string;
  entityId: string;
  /** Called with the new evidenceId after a successful upload. */
  onUploaded: (evidenceId: string) => void;
  /** Comma-separated MIME types the user may pick (default: pdf + common images). */
  accept?: string;
  /** Max file size in MB (default 25). */
  maxSizeMb?: number;
}

const DEFAULT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.heic,.webp";
const DEFAULT_MAX_MB = 25;

function mimeMatches(fileType: string, acceptList: string): boolean {
  if (!acceptList) return true;
  const patterns = acceptList.split(",").map((s) => s.trim().toLowerCase());
  const ft = fileType.toLowerCase();
  return patterns.some((p) => {
    if (p === ft) return true;
    if (p.endsWith("/*")) return ft.startsWith(p.slice(0, -2) + "/");
    // Accept file-extension patterns like ".pdf"
    if (p.startsWith(".")) return ft.includes(p.slice(1));
    return false;
  });
}

export function EvidenceUploader({
  entityType,
  entityId,
  onUploaded,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = DEFAULT_MAX_MB,
}: EvidenceUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [devNotice, setDevNotice] = useState<string | null>(null);
  // Holds the evidenceId that has a successful PUT but a failed confirm —
  // lets the user retry just step 3 instead of re-uploading the whole file.
  const [pendingConfirmId, setPendingConfirmId] = useState<string | null>(null);

  const runConfirm = async (evidenceId: string): Promise<void> => {
    const confirmRes = await fetch(`/api/evidence/${evidenceId}/confirm`, {
      method: "POST",
    });
    if (!confirmRes.ok) {
      const { error: e } = (await confirmRes.json()) as { error?: string };
      throw new Error(e ?? "Could not confirm upload");
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setDevNotice(null);
    setPendingConfirmId(null);

    if (file.type && !mimeMatches(file.type, accept)) {
      setError(`File type not allowed. Accepted: ${accept}`);
      return;
    }

    const maxBytes = maxSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      setError(`File too large — max ${maxSizeMb} MB.`);
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      // Step 1: request signed upload URL
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
        setDevNotice(
          "GCS not configured (dev mode) — skipping file transfer. Evidence row created with PENDING status.",
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

      // Step 3: confirm. Failure here is the only failure mode where the file
      // *did* land in GCS — pin the evidenceId so the user can retry confirm
      // without re-uploading.
      if (init.uploadUrl) {
        try {
          await runConfirm(init.evidenceId);
        } catch (confirmErr) {
          setPendingConfirmId(init.evidenceId);
          throw confirmErr;
        }
      }

      setProgress(100);
      onUploaded(init.evidenceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRetryConfirm = async () => {
    if (!pendingConfirmId) return;
    setError(null);
    setUploading(true);
    try {
      await runConfirm(pendingConfirmId);
      const id = pendingConfirmId;
      setPendingConfirmId(null);
      onUploaded(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="space-y-2">
      {/* Hidden file input lives outside the role="button" div to avoid nested-interactive axe violation */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label="Upload file"
        aria-hidden="true"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <div
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary hover:bg-accent/30"
        onClick={() => !uploading && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            // Space would otherwise scroll the page before opening the
            // picker; Enter is harmless to preventDefault but kept paired
            // for symmetry.
            e.preventDefault();
            if (!uploading) inputRef.current?.click();
          }
        }}
        aria-label="Upload file"
        aria-disabled={uploading}
      >
        <Upload className="mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          Drop a file here or{" "}
          <span className="text-primary underline">click to browse</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {accept.replace(/,/g, ", ")} — up to {maxSizeMb} MB
        </p>
      </div>

      {uploading && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            />
          </div>
          <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {pendingConfirmId && !uploading && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleRetryConfirm()}
        >
          Retry confirm
        </Button>
      )}
      {devNotice && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {devNotice}
        </p>
      )}
    </div>
  );
}
