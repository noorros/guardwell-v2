import { useId } from "react";
import { cn, scoreToColorToken, scoreToLabel } from "@/lib/utils";

export interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  id?: string;
  className?: string;
}

export function ScoreRing({
  score,
  size = 96,
  strokeWidth = 10,
  label,
  id,
  className,
}: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const reactId = useId();
  const titleId = id ?? `scorering-${reactId}`;
  const descId = `${titleId}-desc`;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const stroke = scoreToColorToken(clamped);
  const statusLabel = scoreToLabel(clamped);

  return (
    <div className={cn("inline-flex flex-col items-center gap-1", className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <title id={titleId}>{label ? `${label}: ${clamped}` : `Score ${clamped}`}</title>
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
          className="fill-foreground"
          style={{ fontSize: size * 0.3, fontWeight: 600 }}
        >
          {clamped}
        </text>
      </svg>
      {label && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      <span id={descId} className="sr-only">
        {label ? `${label}: ${clamped} out of 100, ${statusLabel}` : `${clamped} out of 100, ${statusLabel}`}
      </span>
    </div>
  );
}
