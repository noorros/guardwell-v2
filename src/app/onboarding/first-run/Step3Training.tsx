"use client";
import type { HipaaBasicsCourse } from "./WizardShell";
export function Step3Training(_: {
  course: HipaaBasicsCourse | null;
  onComplete: () => void;
}) {
  return <p className="text-sm text-muted-foreground">Step 3 — coming next</p>;
}
