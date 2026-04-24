"use client";
export function Step2Policy(_: {
  template: { code: string; title: string; bodyMarkdown: string } | null;
  onComplete: () => void;
}) {
  return <p className="text-sm text-muted-foreground">Step 2 — coming next</p>;
}
