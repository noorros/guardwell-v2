// src/components/gw/EvidenceBadge/index.tsx
import type { LucideIcon } from "lucide-react";
import { FileText, GraduationCap, Clock, Signature, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

export type EvidenceKind =
  | "policy"
  | "training"
  | "acknowledgment-pending"
  | "attestation"
  | "document";

const KIND_META: Record<EvidenceKind, { Icon: LucideIcon; tone: string }> = {
  "policy":                 { Icon: FileText,       tone: "text-foreground bg-secondary" },
  "training":               { Icon: GraduationCap,  tone: "text-foreground bg-secondary" },
  "acknowledgment-pending": { Icon: Clock,          tone: "text-[color:var(--gw-color-needs)] bg-[color:color-mix(in_oklch,var(--gw-color-needs)_15%,transparent)]" },
  "attestation":            { Icon: Signature,      tone: "text-foreground bg-secondary" },
  "document":               { Icon: Paperclip,      tone: "text-foreground bg-secondary" },
};

export interface EvidenceBadgeProps {
  kind: EvidenceKind;
  label: string;
  href?: string;
  count?: number;
  className?: string;
}

export function EvidenceBadge({ kind, label, href, count, className }: EvidenceBadgeProps) {
  const { Icon, tone } = KIND_META[kind];
  const text = count !== undefined ? `${label} (${count})` : label;
  const body = (
    <>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{text}</span>
    </>
  );
  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
    tone,
    className,
  );
  if (href) {
    return (
      <a href={href} className={cn(classes, "hover:underline underline-offset-2")}>
        {body}
      </a>
    );
  }
  return <span className={classes}>{body}</span>;
}
