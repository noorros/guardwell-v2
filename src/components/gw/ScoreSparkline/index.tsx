// src/components/gw/ScoreSparkline/index.tsx
//
// Inline SVG sparkline of "compliant requirements" over time. No
// dependencies, no client island, no axes — just a quick visual signal
// of whether the practice's compliance is trending up or down.
//
// Caller passes the per-day compliant counts as a number[] (oldest →
// newest). 30 points fits the audit overview header nicely.

interface ScoreSparklineProps {
  /** Per-day counts, oldest first. Empty or single-point input renders nothing visible. */
  points: number[];
  /** Width in pixels. Default 120. */
  width?: number;
  /** Height in pixels. Default 28. */
  height?: number;
  /** Color of the line. Defaults to gw-color-compliant. */
  color?: string;
  /** Aria-label for screen readers. */
  ariaLabel?: string;
}

export function ScoreSparkline({
  points,
  width = 120,
  height = 28,
  color = "var(--gw-color-compliant)",
  ariaLabel,
}: ScoreSparklineProps) {
  if (points.length < 2) {
    return null;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const padding = 2;
  const usableHeight = height - padding * 2;
  const stepX = (width - padding * 2) / (points.length - 1);

  const path = points
    .map((p, i) => {
      const x = padding + i * stepX;
      const y =
        padding + (1 - (p - min) / range) * usableHeight;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  // Last point dot for a recent-value emphasis.
  const lastX = padding + (points.length - 1) * stepX;
  const lastY =
    padding + (1 - (points[points.length - 1]! - min) / range) * usableHeight;

  const trend =
    points[points.length - 1]! - points[0]!;
  const trendLabel =
    trend > 0 ? `up ${trend}` : trend < 0 ? `down ${Math.abs(trend)}` : "flat";
  const computedAriaLabel =
    ariaLabel ??
    `Compliant requirements over time, trending ${trendLabel}`;

  return (
    <svg
      role="img"
      aria-label={computedAriaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
    >
      <path
        d={path}
        stroke={color}
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}

/**
 * Pure helper. Given the current number of compliant items + a list of
 * status-flip events (createdAt + nextStatus + previousStatus) sorted
 * oldest → newest, returns one count per day for the last `days` days,
 * oldest first.
 *
 * The counts are reverse-derived: start from currentCompliant and walk
 * backward through events, undoing each flip's contribution.
 *
 * Examples:
 *   - Event "X: NOT_STARTED → COMPLIANT" added 1 to compliant; reversing
 *     subtracts 1.
 *   - Event "X: COMPLIANT → GAP" subtracted 1; reversing adds 1.
 *   - Event "X: GAP → COMPLIANT" added 1; reversing subtracts 1.
 *   - Event "X: COMPLIANT → COMPLIANT" no-op; reversing no-op.
 *
 * The counts at each day are the count "at end of that day". Today's
 * value is `currentCompliant`.
 */
export interface StatusFlipEvent {
  createdAt: Date;
  previousStatus: string | null;
  nextStatus: string;
}

export function computeDailyCompliantCounts(
  currentCompliant: number,
  events: StatusFlipEvent[],
  days: number,
  /** "now" for testability — defaults to new Date() in production code. */
  now: Date = new Date(),
): number[] {
  const result: number[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  // Truncate "now" to start-of-day UTC so per-day buckets are stable.
  const todayMs = Math.floor(now.getTime() / dayMs) * dayMs;
  // Sort events newest-first.
  const sorted = [...events].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  let count = currentCompliant;
  let eventIdx = 0;
  for (let d = 0; d < days; d++) {
    // Day window: events with createdAt > endOfThisDay haven't happened
    // yet from this day's perspective. The day's count = count after
    // undoing all events strictly newer than endOfThisDay.
    const endOfDayMs = todayMs - d * dayMs + dayMs - 1;
    while (
      eventIdx < sorted.length &&
      sorted[eventIdx]!.createdAt.getTime() > endOfDayMs
    ) {
      const evt = sorted[eventIdx]!;
      const wasCompliant = evt.previousStatus === "COMPLIANT";
      const becameCompliant = evt.nextStatus === "COMPLIANT";
      // Reversing a flip: undo its contribution to the count.
      if (becameCompliant && !wasCompliant) count -= 1;
      else if (!becameCompliant && wasCompliant) count += 1;
      eventIdx += 1;
    }
    result.push(count);
  }

  // Reverse so the array is oldest → newest.
  return result.reverse();
}
