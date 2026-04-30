// src/app/(dashboard)/programs/credentials/grouping.ts
//
// Audit #21 / Credentials CR-4: build the credential-list groups for
// `/programs/credentials`. Pure function — no DB calls, no React — so
// the regression (former-staff credentials must remain visible) is
// straightforward to integration-test.
//
// Group order convention (matches existing UI before this audit, with
// the new "Former staff" tier inserted between active and practice-level):
//   1. Active staff (in the order they appear in the holders array)
//   2. Former staff (PracticeUser.removedAt set; sorted by name for stability)
//   3. Practice-level (holderId === null)
//
// A group only renders if it has at least one credential.

export type HolderForGrouping = {
  id: string;
  displayName: string;
  removedAt: Date | null;
};

// Minimal shape needed to bucket a credential. The page passes the full
// row (Prisma findMany result with `credentialType` join); generics
// preserve that type for callers.
export type CredentialGroupInput = {
  id: string;
  holderId: string | null;
};

export type CredentialGroup<C extends CredentialGroupInput> = {
  /** React key — stable per-group identity. */
  key: string;
  /** Header text shown above the credential list. */
  heading: string;
  /** Whether this is the "Former staff" tier (drives any future UI tweaks). */
  isFormerStaff: boolean;
  /** Whether this is the practice-level tier. */
  isPracticeLevel: boolean;
  credentials: C[];
};

export function buildCredentialGroups<C extends CredentialGroupInput>(
  holders: HolderForGrouping[],
  credentials: C[],
): CredentialGroup<C>[] {
  // Bucket credentials by holderId once.
  const byHolder = new Map<string | null, C[]>();
  for (const c of credentials) {
    const key = c.holderId ?? null;
    if (!byHolder.has(key)) byHolder.set(key, []);
    byHolder.get(key)!.push(c);
  }

  const activeHolders = holders.filter((h) => h.removedAt === null);
  const formerHolders = holders
    .filter((h) => h.removedAt !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const groups: CredentialGroup<C>[] = [];

  // 1. Active staff — preserve the input order.
  for (const h of activeHolders) {
    const list = byHolder.get(h.id);
    if (!list || list.length === 0) continue;
    groups.push({
      key: h.id,
      heading: h.displayName,
      isFormerStaff: false,
      isPracticeLevel: false,
      credentials: list,
    });
  }

  // 2. Former staff — credentials still on the books for renewal /
  //    retirement / handover even though the user is off-boarded.
  for (const h of formerHolders) {
    const list = byHolder.get(h.id);
    if (!list || list.length === 0) continue;
    groups.push({
      key: h.id,
      heading: `Former staff: ${h.displayName}`,
      isFormerStaff: true,
      isPracticeLevel: false,
      credentials: list,
    });
  }

  // 3. Practice-level credentials (holderId === null) come last.
  const practiceLevel = byHolder.get(null);
  if (practiceLevel && practiceLevel.length > 0) {
    groups.push({
      key: "practice-level",
      heading: "Practice-level",
      isFormerStaff: false,
      isPracticeLevel: true,
      credentials: practiceLevel,
    });
  }

  return groups;
}
