// src/app/(dashboard)/programs/policies/[id]/PolicyEditor.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updatePolicyContentAction } from "../actions";

export interface PolicyEditorProps {
  practicePolicyId: string;
  initialContent: string;
  policyTitle: string;
}

export function PolicyEditor({
  practicePolicyId,
  initialContent,
  policyTitle,
}: PolicyEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [content, setContent] = useState(initialContent);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);

  const handleSave = () => {
    setError(null);
    if (!content.trim()) {
      setError("Content cannot be empty.");
      return;
    }
    if (content.length > 200_000) {
      setError(
        `Content too long: ${content.length.toLocaleString()} chars (max 200,000).`,
      );
      return;
    }
    startTransition(async () => {
      try {
        await updatePolicyContentAction({
          practicePolicyId,
          content,
        });
        setSavedAt(new Date());
        setDirty(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  };

  const charCount = content.length;
  const charLabel =
    charCount > 200_000
      ? `${charCount.toLocaleString()} / 200,000 (over limit)`
      : `${charCount.toLocaleString()} / 200,000 chars`;

  return (
    <div className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
          setSavedAt(null);
        }}
        rows={28}
        spellCheck
        className="block w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed"
        aria-label={`Edit ${policyTitle} content`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={
              charCount > 200_000
                ? "text-[color:var(--gw-color-risk)]"
                : ""
            }
          >
            {charLabel}
          </span>
          {dirty && !isPending && (
            <span className="text-[color:var(--gw-color-needs)]">
              · unsaved changes
            </span>
          )}
          {savedAt && !dirty && !isPending && (
            <span className="text-[color:var(--gw-color-compliant)]">
              · saved at {savedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isPending || !dirty || charCount === 0 || charCount > 200_000}
          >
            {isPending
              ? "Saving…"
              : dirty
                ? "Save (bumps version)"
                : "Saved"}
          </Button>
        </div>
      </div>
      {error && (
        <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Saving creates a new version of this policy AND counts as your
        annual review attestation. If you only want to record a review
        without editing, use the "Mark reviewed" button on the
        /programs/policies list.
      </p>
    </div>
  );
}
