import { useId } from "react";
import { Check, AlertTriangle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChecklistStatus = "compliant" | "gap" | "not_started";

export interface ChecklistItemProps {
  title: string;
  description?: string;
  status: ChecklistStatus;
  onStatusChange: (next: ChecklistStatus) => void;
  disabled?: boolean;
  className?: string;
}

const OPTIONS: Array<{
  value: ChecklistStatus;
  label: string;
  Icon: typeof Check;
  activeTone: string;
}> = [
  {
    value: "compliant",
    label: "Compliant",
    Icon: Check,
    activeTone:
      "border-[color:var(--gw-color-compliant)] bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_15%,transparent)] text-[color:var(--gw-color-compliant)]",
  },
  {
    value: "gap",
    label: "Gap",
    Icon: AlertTriangle,
    activeTone:
      "border-[color:var(--gw-color-risk)] bg-[color:color-mix(in_oklch,var(--gw-color-risk)_15%,transparent)] text-[color:var(--gw-color-risk)]",
  },
  {
    value: "not_started",
    label: "Not started",
    Icon: Circle,
    activeTone: "border-border bg-muted text-muted-foreground",
  },
];

export function ChecklistItem({
  title,
  description,
  status,
  onStatusChange,
  disabled,
  className,
}: ChecklistItemProps) {
  const groupId = useId();
  return (
    <div className={cn("flex items-start gap-4 rounded-lg border bg-card p-4", className)}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div role="radiogroup" aria-label={`Status for ${title}`} className="flex shrink-0 gap-1">
        {OPTIONS.map(({ value, label, Icon, activeTone }) => {
          const isActive = status === value;
          return (
            <label
              key={value}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive ? activeTone : "border-border bg-background text-muted-foreground hover:bg-accent",
                disabled && "cursor-not-allowed opacity-50",
              )}
              data-active={isActive ? "true" : "false"}
            >
              <input
                type="radio"
                name={groupId}
                value={value}
                checked={isActive}
                onChange={() => onStatusChange(value)}
                disabled={disabled}
                className="sr-only"
                aria-label={label}
                data-active={isActive ? "true" : "false"}
              />
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
