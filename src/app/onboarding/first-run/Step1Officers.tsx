"use client";
export function Step1Officers(_: {
  owner: { practiceUserId: string; userId: string; displayName: string };
  onComplete: () => void;
}) {
  return <p className="text-sm text-muted-foreground">Step 1 — coming next</p>;
}
