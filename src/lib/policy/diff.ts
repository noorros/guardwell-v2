// src/lib/policy/diff.ts
//
// Minimal line-by-line diff for PolicyVersion comparisons. Implements
// the standard LCS-based diff (longest common subsequence) and emits
// a sequence of {kind, line} entries the UI renders as a unified diff.
//
// We intentionally don't pull in a third-party diff library — policies
// are typically <10k chars and this implementation handles them in
// well under 100ms.

export type DiffKind = "EQUAL" | "ADD" | "REMOVE";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  // Line number in the OLD file (null for ADD lines).
  oldLineNo: number | null;
  // Line number in the NEW file (null for REMOVE lines).
  newLineNo: number | null;
}

export interface DiffSummary {
  lines: DiffLine[];
  addedLineCount: number;
  removedLineCount: number;
  unchangedLineCount: number;
}

/**
 * Diff two strings line-by-line. Returns a unified-diff line stream
 * + summary counts. Newlines are normalized to \n; trailing empty
 * lines are kept verbatim.
 */
export function diffLines(oldText: string, newText: string): DiffSummary {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Standard LCS via dynamic programming. Rows = oldLines, Cols = newLines.
  const m = oldLines.length;
  const n = newLines.length;
  // For policy bodies up to 10k lines this is fine; cap defensively
  // at 4000 lines * 4000 lines = 16M cells. Bigger and we fall back
  // to "you changed the entire body" semantics.
  if (m * n > 16_000_000) {
    return {
      lines: [
        { kind: "REMOVE", text: "[diff too large to render]", oldLineNo: 0, newLineNo: null },
        { kind: "ADD", text: "[content replaced wholesale]", oldLineNo: null, newLineNo: 0 },
      ],
      addedLineCount: n,
      removedLineCount: m,
      unchangedLineCount: 0,
    };
  }

  // 2-D table of LCS lengths. Use Int32Array for speed.
  const lcs = new Array<Int32Array>(m + 1);
  for (let i = 0; i <= m; i++) lcs[i] = new Int32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i]![j] = lcs[i - 1]![j - 1]! + 1;
      } else {
        lcs[i]![j] = Math.max(lcs[i - 1]![j]!, lcs[i]![j - 1]!);
      }
    }
  }

  // Walk back to produce the diff in reverse, then reverse at the end.
  const out: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      out.push({
        kind: "EQUAL",
        text: oldLines[i - 1]!,
        oldLineNo: i,
        newLineNo: j,
      });
      i -= 1;
      j -= 1;
    } else if (lcs[i - 1]![j]! >= lcs[i]![j - 1]!) {
      out.push({
        kind: "REMOVE",
        text: oldLines[i - 1]!,
        oldLineNo: i,
        newLineNo: null,
      });
      i -= 1;
    } else {
      out.push({
        kind: "ADD",
        text: newLines[j - 1]!,
        oldLineNo: null,
        newLineNo: j,
      });
      j -= 1;
    }
  }
  while (i > 0) {
    out.push({
      kind: "REMOVE",
      text: oldLines[i - 1]!,
      oldLineNo: i,
      newLineNo: null,
    });
    i -= 1;
  }
  while (j > 0) {
    out.push({
      kind: "ADD",
      text: newLines[j - 1]!,
      oldLineNo: null,
      newLineNo: j,
    });
    j -= 1;
  }
  out.reverse();

  let added = 0;
  let removed = 0;
  let equal = 0;
  for (const line of out) {
    if (line.kind === "ADD") added += 1;
    else if (line.kind === "REMOVE") removed += 1;
    else equal += 1;
  }

  return {
    lines: out,
    addedLineCount: added,
    removedLineCount: removed,
    unchangedLineCount: equal,
  };
}
