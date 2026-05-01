// src/lib/sra/grouping.ts
//
// Pure helper that groups a flat array of SraQuestion rows by category.
// Used by the wizard to render one tab per category and by the scoring
// helper to weight by section.

export interface SraQuestionLite {
  id: string;
  code: string;
  category: "ADMINISTRATIVE" | "PHYSICAL" | "TECHNICAL";
  subcategory: string;
  sortOrder: number;
  riskWeight: "LOW" | "MEDIUM" | "HIGH";
}

export type GroupedSra<T extends SraQuestionLite = SraQuestionLite> = Record<
  "ADMINISTRATIVE" | "PHYSICAL" | "TECHNICAL",
  T[]
>;

export function groupSraQuestions<T extends SraQuestionLite>(
  questions: T[],
): GroupedSra<T> {
  const grouped: GroupedSra<T> = {
    ADMINISTRATIVE: [],
    PHYSICAL: [],
    TECHNICAL: [],
  };
  // Stable sort by (subcategory, sortOrder).
  const sorted = [...questions].sort(
    (a, b) =>
      a.subcategory.localeCompare(b.subcategory) || a.sortOrder - b.sortOrder,
  );
  for (const q of sorted) {
    grouped[q.category].push(q);
  }
  return grouped;
}
