import { useId } from "react";
import {
  cn,
  scoreToColorToken,
  scoreToLabel,
  NOT_ASSESSED_LABEL,
  NOT_ASSESSED_COLOR_TOKEN,
} from "@/lib/utils";

export interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  id?: string;
  className?: string;
  /**
   * When false, the ring renders in the "Not assessed" setup state: blue
   * stroke, no fill arc, muted score text (em dash), "Not assessed"
   * status label. Defaults to true so existing call sites stay unchanged.
   */
  assessed?: boolean;
}

export function ScoreRing({
  score,
  size = 96,
  strokeWidth = 10,
  label,
  id,
  className,
  assessed = true,
}: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const reactId = useId();
  const titleId = id ?? `scorering-${reactId}`;
  const descId = `${titleId}-desc`;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Setup state leaves the arc empty (offset == circumference) so it
  // reads as "nothing measured yet" rather than "scored zero".
  const offset = assessed ? circumference * (1 - clamped / 100) : circumference;
  const stroke = assessed ? scoreToColorToken(clamped) : NOT_ASSESSED_COLOR_TOKEN;
  const statusLabel = assessed ? scoreToLabel(clamped) : NOT_ASSESSED_LABEL;

  return (
    <div
      className={cn("inline-flex flex-col items-center gap-1", className)}
      data-assessed={assessed ? "true" : "false"}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <title id={titleId}>
          {label
            ? `${label}: ${assessed ? clamped : NOT_ASSESSED_LABEL}`
            : assessed
              ? `Score ${clamped}`
              : NOT_ASSESSED_LABEL}
        </title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--border)"
          strokeWidth={strokeWidth}
          fill="none"
          data-role="bg"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          data-role="fg"
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className={assessed ? "fill-foreground" : "fill-muted-foreground"}
          style={{ fontSize: size * 0.3, fontWeight: 600 }}
        >
          {assessed ? clamped : "—"}
        </text>
      </svg>
      {label && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      <span id={descId} className="sr-only">
        {label
          ? `${label}: ${assessed ? `${clamped} out of 100, ${statusLabel}` : statusLabel}`
          : assessed
            ? `${clamped} out of 100, ${statusLabel}`
            : statusLabel}
      </span>
    </div>
  );
}
