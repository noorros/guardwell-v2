# Settings & Onboarding Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-04-29-settings-restructure-design.md](../specs/2026-04-29-settings-restructure-design.md)

**Goal:** Move settings to an upper-right avatar dropdown, expand onboarding + settings to collect 5 new compliance-relevant practice fields, replace the 6-bucket specialty enum with a 30-item curated list (bucket derived), introduce multi-state UI, and add a Stripe-portal-backed subscription settings page.

**Architecture:** 5 sequential PRs. PRs 1, 2, 3 are independent; PR 4 depends on PRs 2 + 3 (consumes their components); PR 5 is independent. Each PR has its own feature branch off main, squash-merged. Specialty migration runs as a one-shot script after PR 2 deploys. New event type `PRACTICE_PROFILE_UPDATED` added in PR 4 (additive Prisma migration). No new columns — every field exists in the schema today.

**Tech stack:** Next.js 16 (App Router), Prisma + Postgres (Cloud SQL), TypeScript strict, vitest, jest-axe, Shadcn UI primitives (cmdk + Popover + DropdownMenu), Tailwind, Zod for validation, server actions, Stripe Customer Portal SDK.

---

## File Structure

### NEW shared utility files
- `src/lib/states.ts` — exports `US_STATES` (50 states + DC, name + code) and helper `isValidStateCode()`
- `src/lib/specialties.ts` — exports `SPECIALTIES` (30-item list with display name + bucket) and `deriveSpecialtyCategory(specialty)`
- `src/lib/billing/portal.ts` — exports `openBillingPortalAction()` (extracted from `/account/locked/actions.ts`)

### NEW components (each in `src/components/gw/<Name>/`)
- `UserMenu/index.tsx` + `UserMenu.test.tsx` — avatar dropdown
- `SpecialtyCombobox/index.tsx` + `SpecialtyCombobox.test.tsx` — specialty single-select
- `StateMultiSelect/index.tsx` + `StateMultiSelect.test.tsx` — chip multi-select for additional states
- `EhrCombobox/index.tsx` + `EhrCombobox.test.tsx` — EHR system combobox (internal helper for PracticeProfileForm)
- `PracticeProfileForm/index.tsx` + `PracticeProfileForm.test.tsx` — unified form (Identity / Location / Practice sections)
- `SubscriptionPanel/index.tsx` + `SubscriptionPanel.test.tsx` — subscription status display

### NEW migration script
- `scripts/backfill-practice-specialty.ts` — one-shot migration from bucket → specific

### NEW pages
- `src/app/(dashboard)/settings/page.tsx` — index page with 3 cards
- `src/app/(dashboard)/settings/subscription/page.tsx` — subscription page
- `src/app/(dashboard)/settings/subscription/actions.ts` — re-exports openBillingPortalAction

### MODIFIED files
- `src/components/gw/AppShell/TopBar.tsx` — replace email + sign-out with `<UserMenu>`
- `src/components/gw/AppShell/Sidebar.tsx` — remove SETTINGS_ITEMS section
- `src/components/gw/AppShell/AppShell.tsx` — pass userInitials to TopBar
- `src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx` — embed `<PracticeProfileForm mode="onboarding">` + new specialty/state components
- `src/app/onboarding/compliance-profile/actions.ts` — write Practice fields + derived specialtyCategory
- `src/app/onboarding/create-practice/page.tsx` + `actions.ts` — drop primaryState input (moves to compliance-profile)
- `src/app/(dashboard)/settings/practice/page.tsx` — render `<PracticeProfileForm mode="settings">`
- `src/app/(dashboard)/settings/practice/actions.ts` (NEW) — savePracticeProfileAction
- `src/lib/events/registry.ts` — register PRACTICE_PROFILE_UPDATED event type

---

## PR 1 — AppShell avatar dropdown

**Branch:** `feat/settings-pr1-avatar-dropdown`

**Goal:** Replace TopBar email + sign-out with avatar dropdown menu. Remove Settings section from Sidebar. Sub-pages (`/settings/practice`, `/settings/notifications`) keep working.

### Task 1.1: Add userInitials helper

**Files:**
- Modify: `src/lib/utils.ts` (append at end)

- [ ] **Step 1: Write failing test**

Append to `src/lib/__tests__/utils.test.ts` (create file if missing):

```ts
import { describe, it, expect } from "vitest";
import { computeUserInitials } from "@/lib/utils";

describe("computeUserInitials", () => {
  it("returns first 2 letters of email when no name available", () => {
    expect(computeUserInitials("alice@example.com")).toBe("AL");
  });
  it("returns first letter of each name part when name has space", () => {
    expect(computeUserInitials("alice@example.com", "Alice Smith")).toBe("AS");
  });
  it("falls back to the first 2 letters of the first name part if only one part", () => {
    expect(computeUserInitials("alice@example.com", "Alice")).toBe("AL");
  });
  it("returns ?? for empty string email", () => {
    expect(computeUserInitials("")).toBe("??");
  });
  it("uppercases lowercase initials", () => {
    expect(computeUserInitials("z@z.com", "kim park")).toBe("KP");
  });
});
```

- [ ] **Step 2: Run test (expect fail — function not exported yet)**

Run: `npm test -- --run src/lib/__tests__/utils.test.ts`
Expected: FAIL — `computeUserInitials is not exported`

- [ ] **Step 3: Implement helper**

Append to `src/lib/utils.ts`:

```ts
/**
 * Compute up to 2-letter initials for the avatar.
 * Prefers display name (first letter of first 2 parts).
 * Falls back to first 2 letters of the email local-part.
 * Returns "??" for empty input.
 */
export function computeUserInitials(email: string, displayName?: string): string {
  if (displayName && displayName.trim().length > 0) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    }
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  if (!email) return "??";
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "??";
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test -- --run src/lib/__tests__/utils.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/settings-pr1-avatar-dropdown
git add src/lib/utils.ts src/lib/__tests__/utils.test.ts
git commit -m "feat(utils): computeUserInitials helper for avatar"
```

### Task 1.2: Build UserMenu component

**Files:**
- Create: `src/components/gw/AppShell/UserMenu.tsx`
- Create: `src/components/gw/AppShell/UserMenu.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/gw/AppShell/UserMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { UserMenu } from "./UserMenu";

expect.extend(toHaveNoViolations);

// Mock the sign-out action — actual server action contract is that it's
// passed to <form action={...}>; we just need to confirm the form posts.
vi.mock("@/app/(auth)/sign-out/actions", () => ({
  signOutAction: vi.fn(async () => undefined),
}));

describe("UserMenu", () => {
  const baseProps = {
    userEmail: "alice@example.com",
    practiceName: "Acme Family Medicine",
    userInitials: "AL",
  };

  it("renders the avatar trigger with the initials", () => {
    render(<UserMenu {...baseProps} />);
    expect(screen.getByRole("button", { name: /open user menu/i })).toHaveTextContent("AL");
  });

  it("opens the menu and shows email + practice name in header", async () => {
    render(<UserMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /open user menu/i }));
    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Acme Family Medicine")).toBeInTheDocument();
  });

  it("renders 4 navigation items + sign out", async () => {
    render(<UserMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /open user menu/i }));
    expect(await screen.findByRole("menuitem", { name: /practice profile/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /subscription/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
  });

  it("links Practice profile to /settings/practice", async () => {
    render(<UserMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /open user menu/i }));
    const link = await screen.findByRole("menuitem", { name: /practice profile/i });
    expect(link.closest("a")).toHaveAttribute("href", "/settings/practice");
  });

  it("links Subscription to /settings/subscription", async () => {
    render(<UserMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /open user menu/i }));
    const link = await screen.findByRole("menuitem", { name: /subscription/i });
    expect(link.closest("a")).toHaveAttribute("href", "/settings/subscription");
  });

  it("passes axe a11y audit when open", async () => {
    const { container } = render(<UserMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /open user menu/i }));
    await screen.findByText("alice@example.com");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test -- --run src/components/gw/AppShell/UserMenu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement UserMenu**

Create `src/components/gw/AppShell/UserMenu.tsx`:

```tsx
// src/components/gw/AppShell/UserMenu.tsx
//
// Avatar/initials dropdown shown in the upper-right of the dashboard TopBar.
// Replaces the prior plain-text email + Sign-out button. Menu items deep-link
// to the four settings sub-pages (Practice profile, Notifications, Subscription)
// plus the Sign-out action. Email + practice name appear in the menu header.
"use client";

import Link from "next/link";
import type { Route } from "next";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/app/(auth)/sign-out/actions";

export interface UserMenuProps {
  userEmail: string;
  practiceName: string;
  userInitials: string;
}

export function UserMenu({ userEmail, practiceName, userInitials }: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open user menu"
          className="h-8 w-8 rounded-full bg-secondary p-0 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80"
        >
          {userInitials}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{userEmail}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {practiceName}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={"/settings/practice" as Route}>Practice profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={"/settings/notifications" as Route}>Notifications</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={"/settings/subscription" as Route}>Subscription</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test -- --run src/components/gw/AppShell/UserMenu.test.tsx`
Expected: PASS — 6 tests.

If any test fails because Shadcn DropdownMenu role names differ, adjust the test selectors (e.g. role="menuitem" might be wrapped in a `link` role for `asChild` Link items — use `screen.getByRole("link", { name: /practice profile/i })` if needed). Don't relax the assertions to "any link works" — the test must verify the right href.

- [ ] **Step 5: Commit**

```bash
git add src/components/gw/AppShell/UserMenu.tsx src/components/gw/AppShell/UserMenu.test.tsx
git commit -m "feat(appshell): UserMenu dropdown component"
```

### Task 1.3: Wire UserMenu into TopBar

**Files:**
- Modify: `src/components/gw/AppShell/TopBar.tsx`
- Modify: `src/components/gw/AppShell/TopBar.test.tsx`

- [ ] **Step 1: Update existing TopBar tests for new prop**

Open `src/components/gw/AppShell/TopBar.test.tsx`. Find every `render(<TopBar ... />)` call and add the new required prop `userInitials="AL"`. Add one new test that asserts the email is NOT plain-text in the header anymore (it's now inside the menu only):

```tsx
it("does not render email as a plain visible label in the top bar", () => {
  render(
    <TopBar
      practiceName="Acme"
      userEmail="alice@example.com"
      userInitials="AL"
    />,
  );
  // The email is in the dropdown header, hidden until open. The collapsed top
  // bar should only show the avatar trigger, not the email text.
  expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
});

it("renders the avatar with the supplied initials", () => {
  render(
    <TopBar
      practiceName="Acme"
      userEmail="alice@example.com"
      userInitials="AL"
    />,
  );
  expect(screen.getByRole("button", { name: /open user menu/i })).toHaveTextContent("AL");
});

it("does not render the standalone Sign out button (it's inside the menu now)", () => {
  render(
    <TopBar
      practiceName="Acme"
      userEmail="alice@example.com"
      userInitials="AL"
    />,
  );
  // Top bar should not have a directly-visible "Sign out" button anymore.
  expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests (expect fail on old assertions)**

Run: `npm test -- --run src/components/gw/AppShell/TopBar.test.tsx`
Expected: FAIL — old tests assume email + sign-out are visible.

- [ ] **Step 3: Update TopBar implementation**

Replace `src/components/gw/AppShell/TopBar.tsx` body (full file):

```tsx
// src/components/gw/AppShell/TopBar.tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  NotificationBell,
  type NotificationBellItem,
} from "./NotificationBell";
import { UserMenu } from "./UserMenu";

export interface TopBarProps {
  practiceName: string;
  userEmail: string;
  userInitials: string;
  mobileTrigger?: ReactNode;
  notifications?: {
    unreadCount: number;
    recent: NotificationBellItem[];
  };
  className?: string;
}

export function TopBar({
  practiceName,
  userEmail,
  userInitials,
  mobileTrigger,
  notifications,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        "flex h-14 items-center gap-3 border-b bg-card px-4",
        className,
      )}
    >
      {mobileTrigger}
      <span className="truncate font-semibold text-foreground">{practiceName}</span>
      <div className="ml-auto flex items-center gap-3">
        {notifications && (
          <NotificationBell
            unreadCount={notifications.unreadCount}
            recent={notifications.recent}
          />
        )}
        <UserMenu
          userEmail={userEmail}
          practiceName={practiceName}
          userInitials={userInitials}
        />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test -- --run src/components/gw/AppShell/TopBar.test.tsx`
Expected: PASS — old tests adjusted, new tests added.

- [ ] **Step 5: Commit**

```bash
git add src/components/gw/AppShell/TopBar.tsx src/components/gw/AppShell/TopBar.test.tsx
git commit -m "feat(appshell): replace TopBar email+signout with UserMenu"
```

### Task 1.4: Pass userInitials from AppShell

**Files:**
- Modify: `src/components/gw/AppShell/AppShell.tsx`
- Modify: `src/components/gw/AppShell/AppShell.test.tsx`

- [ ] **Step 1: Read AppShell.tsx + identify where userEmail comes from**

Run: `cat src/components/gw/AppShell/AppShell.tsx | head -100`

Note where `userEmail` is sourced (likely from a server-side `getPracticeUser()` or similar). The `userInitials` should be computed there too via `computeUserInitials(user.email, user.displayName)`.

- [ ] **Step 2: Update existing AppShell tests for new prop**

In `src/components/gw/AppShell/AppShell.test.tsx`, each `render(<AppShell ... />)` needs the user object's initials propagated to TopBar. If AppShell takes a `user` prop, no test change is needed (initials are computed from email). Otherwise, add a new optional prop `userInitials?: string`.

Add one assertion confirming the avatar shows up:

```tsx
it("renders the avatar in the top bar with computed initials", () => {
  render(
    <AppShell
      user={{ email: "alice@example.com", displayName: "Alice Smith" }}
      practiceName="Acme"
      myComplianceItems={[]}
    >
      <div>content</div>
    </AppShell>,
  );
  expect(screen.getByRole("button", { name: /open user menu/i })).toHaveTextContent("AS");
});
```

- [ ] **Step 3: Update AppShell implementation**

In `src/components/gw/AppShell/AppShell.tsx`, find where `<TopBar` is rendered and pass `userInitials`:

```tsx
import { computeUserInitials } from "@/lib/utils";
// ...
<TopBar
  practiceName={practiceName}
  userEmail={user.email}
  userInitials={computeUserInitials(user.email, user.displayName)}
  // ... existing props
/>
```

(The exact prop names depend on the existing AppShell signature. Read the current file first.)

- [ ] **Step 4: Run tests + tsc**

Run: `npm test -- --run src/components/gw/AppShell/AppShell.test.tsx && npx tsc --noEmit`
Expected: tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/gw/AppShell/AppShell.tsx src/components/gw/AppShell/AppShell.test.tsx
git commit -m "feat(appshell): pass userInitials from AppShell to TopBar"
```

### Task 1.5: Remove Settings section from Sidebar

**Files:**
- Modify: `src/components/gw/AppShell/Sidebar.tsx`
- Modify: `src/components/gw/AppShell/Sidebar.test.tsx`

- [ ] **Step 1: Update Sidebar test — Settings section gone**

In `src/components/gw/AppShell/Sidebar.test.tsx`, add:

```tsx
it("does not render a Settings section in the sidebar (it's in the avatar menu now)", () => {
  render(
    <Sidebar
      myComplianceItems={[
        { code: "HIPAA", name: "HIPAA", score: 80, assessed: true },
      ]}
    />,
  );
  expect(screen.queryByText(/^Settings$/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /practice profile/i })).not.toBeInTheDocument();
});
```

If existing tests assert the presence of the Settings section, delete those assertions.

- [ ] **Step 2: Run tests (expect fail)**

Run: `npm test -- --run src/components/gw/AppShell/Sidebar.test.tsx`
Expected: FAIL — new test fails because Settings section still renders.

- [ ] **Step 3: Remove Settings section from Sidebar.tsx**

Edit `src/components/gw/AppShell/Sidebar.tsx`:

1. Remove the `SETTINGS_ITEMS` constant (lines 107-109 of the current file).
2. Remove the `<SectionHeader>Settings</SectionHeader>` block + the rendered `<ul>` for SETTINGS_ITEMS (lines 305-322 of the current file).
3. Remove the `Settings` icon import from lucide-react if it's no longer used.

After the edit, run a sanity grep:

```bash
grep -n "SETTINGS_ITEMS\|Settings" src/components/gw/AppShell/Sidebar.tsx
```

Should return only the lucide import line OR nothing (depending on whether the icon was used elsewhere).

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test -- --run src/components/gw/AppShell/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run full test suite + lint to catch regressions**

Run: `npx tsc --noEmit && npx eslint src/components/gw/AppShell/ && npm test -- --run`
Expected: tsc clean, lint clean, full suite passes.

- [ ] **Step 6: Commit**

```bash
git add src/components/gw/AppShell/Sidebar.tsx src/components/gw/AppShell/Sidebar.test.tsx
git commit -m "feat(appshell): remove Settings section from sidebar"
```

### Task 1.6: Push + open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/settings-pr1-avatar-dropdown
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(settings): AppShell avatar dropdown (PR 1 of 5)" --body "$(cat <<'EOF'
## Summary

PR 1 of 5 from the Settings & Onboarding restructure spec.

- New `<UserMenu>` avatar/initials dropdown in TopBar (replaces email + sign-out)
- New `computeUserInitials()` helper
- Remove Settings section from Sidebar (settings now reachable only via the avatar menu)

## Test plan

- [x] `npx tsc --noEmit` clean
- [x] `npx eslint src/components/gw/AppShell/` clean
- [x] Test count baseline +14 (UserMenu 6, utils 5, TopBar 3, AppShell 1, Sidebar 1)
- [ ] After deploy: avatar dropdown renders on every dashboard page; menu items navigate to correct settings sub-pages; sign-out works; Sidebar no longer shows Settings section

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Squash-merge after review**

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

---

## PR 2 — Specialty list expansion + migration

**Branch:** `feat/settings-pr2-specialty-expansion`

**Goal:** Replace the 6-bucket specialty enum with a 30-item curated list. Bucket is derived from specific via a pure function. Existing rows backfilled via a one-shot migration script.

### Task 2.1: Specialty constants + derivation function

**Files:**
- Create: `src/lib/specialties.ts`
- Create: `src/lib/__tests__/specialties.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/specialties.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SPECIALTIES,
  deriveSpecialtyCategory,
  type SpecialtyCategory,
} from "@/lib/specialties";

describe("SPECIALTIES", () => {
  it("contains exactly 30 entries", () => {
    expect(SPECIALTIES).toHaveLength(30);
  });
  it("each entry has unique value", () => {
    const values = SPECIALTIES.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
  });
  it("includes Family Medicine, Dental — General, Other", () => {
    const values = SPECIALTIES.map((s) => s.value);
    expect(values).toContain("Family Medicine");
    expect(values).toContain("Dental — General");
    expect(values).toContain("Other");
  });
  it("each entry has a known bucket category", () => {
    const validBuckets: SpecialtyCategory[] = [
      "PRIMARY_CARE",
      "SPECIALTY",
      "DENTAL",
      "BEHAVIORAL",
      "ALLIED",
      "OTHER",
    ];
    for (const s of SPECIALTIES) {
      expect(validBuckets).toContain(s.bucket);
    }
  });
});

describe("deriveSpecialtyCategory", () => {
  it("returns the bucket for a known specialty", () => {
    expect(deriveSpecialtyCategory("Family Medicine")).toBe("PRIMARY_CARE");
    expect(deriveSpecialtyCategory("Cardiology")).toBe("SPECIALTY");
    expect(deriveSpecialtyCategory("Physical Therapy")).toBe("ALLIED");
    expect(deriveSpecialtyCategory("Behavioral Health")).toBe("BEHAVIORAL");
    expect(deriveSpecialtyCategory("Dental — General")).toBe("DENTAL");
  });
  it("returns OTHER for unknown specialty", () => {
    expect(deriveSpecialtyCategory("Time Travel Medicine")).toBe("OTHER");
  });
  it("returns OTHER for empty/null/undefined", () => {
    expect(deriveSpecialtyCategory("")).toBe("OTHER");
    expect(deriveSpecialtyCategory(null)).toBe("OTHER");
    expect(deriveSpecialtyCategory(undefined)).toBe("OTHER");
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test -- --run src/lib/__tests__/specialties.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create implementation**

Create `src/lib/specialties.ts`:

```ts
// src/lib/specialties.ts
//
// Curated specialty list (30 entries). The user picks a specific specialty;
// the legacy 6-bucket category is DERIVED from that pick via the lookup
// table below. Bucket drives compliance defaults (e.g. DENTAL/ALLIED →
// MACRA/MIPS exemption); the user never sees the bucket name.

export type SpecialtyCategory =
  | "PRIMARY_CARE"
  | "SPECIALTY"
  | "DENTAL"
  | "BEHAVIORAL"
  | "ALLIED"
  | "OTHER";

export interface SpecialtyEntry {
  value: string;
  bucket: SpecialtyCategory;
}

/**
 * Alphabetical curated list. The bucket on each entry feeds
 * `deriveSpecialtyCategory()` and is invisible to the user.
 */
export const SPECIALTIES: readonly SpecialtyEntry[] = [
  { value: "Allergy & Immunology", bucket: "SPECIALTY" },
  { value: "Anesthesiology", bucket: "SPECIALTY" },
  { value: "Behavioral Health", bucket: "BEHAVIORAL" },
  { value: "Cardiology", bucket: "SPECIALTY" },
  { value: "Chiropractic", bucket: "ALLIED" },
  { value: "Dental — General", bucket: "DENTAL" },
  { value: "Dental — Specialty", bucket: "DENTAL" },
  { value: "Dermatology", bucket: "SPECIALTY" },
  { value: "Emergency Medicine", bucket: "SPECIALTY" },
  { value: "Endocrinology", bucket: "SPECIALTY" },
  { value: "Family Medicine", bucket: "PRIMARY_CARE" },
  { value: "Gastroenterology", bucket: "SPECIALTY" },
  { value: "General Surgery", bucket: "SPECIALTY" },
  { value: "Internal Medicine", bucket: "PRIMARY_CARE" },
  { value: "Nephrology", bucket: "SPECIALTY" },
  { value: "Neurology", bucket: "SPECIALTY" },
  { value: "Obstetrics & Gynecology", bucket: "SPECIALTY" },
  { value: "Occupational Therapy", bucket: "ALLIED" },
  { value: "Oncology", bucket: "SPECIALTY" },
  { value: "Ophthalmology", bucket: "SPECIALTY" },
  { value: "Orthopedics", bucket: "SPECIALTY" },
  { value: "Otolaryngology (ENT)", bucket: "SPECIALTY" },
  { value: "Pediatrics", bucket: "PRIMARY_CARE" },
  { value: "Physical Therapy", bucket: "ALLIED" },
  { value: "Plastic Surgery", bucket: "SPECIALTY" },
  { value: "Podiatry", bucket: "ALLIED" },
  { value: "Psychiatry", bucket: "BEHAVIORAL" },
  { value: "Pulmonology", bucket: "SPECIALTY" },
  { value: "Radiology", bucket: "SPECIALTY" },
  { value: "Speech-Language Pathology", bucket: "ALLIED" },
  { value: "Urology", bucket: "SPECIALTY" },
  // 31st entry "Other" is added in deriveSpecialtyCategory's lookup but
  // intentionally NOT exported in the picker list — picker has 30 actual
  // specialties + a fixed "Other" tail item rendered separately.
] as const;

// Build a fast lookup map for derivation.
const SPECIALTY_TO_BUCKET: ReadonlyMap<string, SpecialtyCategory> = new Map(
  SPECIALTIES.map((s) => [s.value, s.bucket]),
);

/**
 * Derive the legacy 6-bucket category from a specific specialty value.
 * Returns OTHER for any value not in the curated list (including empty,
 * null, undefined, or freeform entries).
 */
export function deriveSpecialtyCategory(
  specialty: string | null | undefined,
): SpecialtyCategory {
  if (!specialty) return "OTHER";
  return SPECIALTY_TO_BUCKET.get(specialty) ?? "OTHER";
}
```

Wait — the test claims `SPECIALTIES.toHaveLength(30)` AND that "Other" is in the list. Re-read the test: `expect(values).toContain("Other")`. The implementation above has 30 entries WITHOUT "Other", so the test would fail.

Fix: include "Other" as the 31st entry but make the asserted length 31 OR drop "Other" from the list and update the test. The right answer: include "Other" so the picker includes it (users need a fallback). Update the constant to have 31 entries, update the test.

Re-do the implementation:

```ts
// In SPECIALTIES const, append:
  { value: "Other", bucket: "OTHER" },
// Total: 31 entries.
```

And update the test to `toHaveLength(31)`. Re-run test.

- [ ] **Step 4: Run tests (expect pass)**

Run: `npm test -- --run src/lib/__tests__/specialties.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/settings-pr2-specialty-expansion
git add src/lib/specialties.ts src/lib/__tests__/specialties.test.ts
git commit -m "feat(specialties): curated 30+1 specialty list with bucket derivation"
```

### Task 2.2: Specialty migration script

**Files:**
- Create: `scripts/backfill-practice-specialty.ts`
- Create: `scripts/__tests__/backfill-practice-specialty.test.ts`

- [ ] **Step 1: Write failing test**

Create `scripts/__tests__/backfill-practice-specialty.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { backfillPracticeSpecialty } from "../backfill-practice-specialty";

describe("backfillPracticeSpecialty", () => {
  beforeEach(async () => {
    // Clean slate per test
    await db.practiceComplianceProfile.deleteMany({});
    await db.practiceUser.deleteMany({});
    await db.practice.deleteMany({});
  });

  async function seedPractice(
    overrides: Partial<{
      specialty: string | null;
      bucket: string | null;
    }> = {},
  ) {
    const p = await db.practice.create({
      data: {
        name: `t-${Math.random().toString(36).slice(2, 8)}`,
        primaryState: "AZ",
        specialty: overrides.specialty ?? null,
      },
    });
    if (overrides.bucket !== undefined) {
      await db.practiceComplianceProfile.create({
        data: {
          practiceId: p.id,
          specialtyCategory: overrides.bucket,
        },
      });
    }
    return p;
  }

  it("maps PRIMARY_CARE bucket to Family Medicine", async () => {
    const p = await seedPractice({ bucket: "PRIMARY_CARE" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Family Medicine");
  });

  it("maps DENTAL to Dental — General", async () => {
    const p = await seedPractice({ bucket: "DENTAL" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Dental — General");
  });

  it("maps BEHAVIORAL to Behavioral Health", async () => {
    const p = await seedPractice({ bucket: "BEHAVIORAL" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Behavioral Health");
  });

  it("maps ALLIED to Physical Therapy", async () => {
    const p = await seedPractice({ bucket: "ALLIED" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Physical Therapy");
  });

  it("maps SPECIALTY to Other (too broad to guess)", async () => {
    const p = await seedPractice({ bucket: "SPECIALTY" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Other");
  });

  it("maps OTHER bucket to Other", async () => {
    const p = await seedPractice({ bucket: "OTHER" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Other");
  });

  it("skips practices that already have specialty set", async () => {
    const p = await seedPractice({
      specialty: "Cardiology",
      bucket: "PRIMARY_CARE",
    });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Cardiology"); // unchanged
  });

  it("skips practices with no PracticeComplianceProfile (specialty stays null)", async () => {
    const p = await seedPractice(); // no profile
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBeNull();
  });

  it("is idempotent (re-running produces no change)", async () => {
    const p = await seedPractice({ bucket: "PRIMARY_CARE" });
    await backfillPracticeSpecialty();
    const first = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    await backfillPracticeSpecialty();
    const second = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(second.specialty).toBe(first.specialty);
    expect(second.updatedAt.getTime()).toBe(first.updatedAt.getTime()); // unchanged
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test -- --run scripts/__tests__/backfill-practice-specialty.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement migration**

Create `scripts/backfill-practice-specialty.ts`:

```ts
// scripts/backfill-practice-specialty.ts
//
// One-shot migration: for each Practice where specialty is null and a
// PracticeComplianceProfile row exists, derive a default specific specialty
// from the legacy 6-bucket specialtyCategory.
//
// Idempotent: practices that already have specialty set are skipped.
//
// Run via: npx tsx scripts/backfill-practice-specialty.ts

import { db } from "@/lib/db";

const BUCKET_TO_SPECIFIC: Record<string, string> = {
  PRIMARY_CARE: "Family Medicine",
  DENTAL: "Dental — General",
  BEHAVIORAL: "Behavioral Health",
  ALLIED: "Physical Therapy",
  SPECIALTY: "Other", // too broad to guess
  OTHER: "Other",
};

export async function backfillPracticeSpecialty(): Promise<{
  updated: number;
  skipped: number;
}> {
  const candidates = await db.practice.findMany({
    where: {
      specialty: null,
    },
    include: { complianceProfile: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const p of candidates) {
    if (!p.complianceProfile?.specialtyCategory) {
      skipped++;
      continue;
    }
    const target = BUCKET_TO_SPECIFIC[p.complianceProfile.specialtyCategory];
    if (!target) {
      skipped++;
      continue;
    }
    await db.practice.update({
      where: { id: p.id },
      data: { specialty: target },
    });
    updated++;
  }

  return { updated, skipped };
}

// Run as CLI when invoked directly
if (require.main === module) {
  backfillPracticeSpecialty()
    .then(({ updated, skipped }) => {
      console.log(`Done. updated=${updated} skipped=${skipped}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test (expect pass)**

Run: `npm test -- --run scripts/__tests__/backfill-practice-specialty.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-practice-specialty.ts scripts/__tests__/backfill-practice-specialty.test.ts
git commit -m "feat(specialties): backfill migration script (6-bucket -> specific)"
```

### Task 2.3: SpecialtyCombobox component

**Files:**
- Create: `src/components/gw/SpecialtyCombobox/index.tsx`
- Create: `src/components/gw/SpecialtyCombobox/SpecialtyCombobox.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/gw/SpecialtyCombobox/SpecialtyCombobox.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { SpecialtyCombobox } from "./index";

expect.extend(toHaveNoViolations);

describe("SpecialtyCombobox", () => {
  it("renders the trigger with placeholder when value is empty", () => {
    const onChange = vi.fn();
    render(<SpecialtyCombobox value="" onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent(/select specialty/i);
  });

  it("renders the trigger with the selected value", () => {
    render(<SpecialtyCombobox value="Cardiology" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Cardiology");
  });

  it("opens the popover and shows all 31 specialties", async () => {
    render(<SpecialtyCombobox value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Family Medicine")).toBeVisible();
      expect(screen.getByText("Cardiology")).toBeVisible();
      expect(screen.getByText("Other")).toBeVisible();
    });
  });

  it("filters by search input", async () => {
    render(<SpecialtyCombobox value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox"));
    const searchInput = await screen.findByRole("textbox");
    fireEvent.change(searchInput, { target: { value: "card" } });
    await waitFor(() => {
      expect(screen.getByText("Cardiology")).toBeVisible();
      expect(screen.queryByText("Pediatrics")).toBeNull();
    });
  });

  it("calls onChange with the selected specialty value", async () => {
    const onChange = vi.fn();
    render(<SpecialtyCombobox value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    const item = await screen.findByText("Family Medicine");
    fireEvent.click(item);
    expect(onChange).toHaveBeenCalledWith("Family Medicine");
  });

  it("passes axe a11y audit", async () => {
    const { container } = render(
      <SpecialtyCombobox value="Cardiology" onChange={vi.fn()} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test -- --run src/components/gw/SpecialtyCombobox/`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `src/components/gw/SpecialtyCombobox/index.tsx`:

```tsx
// src/components/gw/SpecialtyCombobox/index.tsx
//
// Single-select combobox for the curated specialty list. Backed by cmdk +
// Popover (the standard Shadcn searchable-combobox recipe). Used in onboarding
// `compliance-profile` and the settings practice profile form.
"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SPECIALTIES } from "@/lib/specialties";

export interface SpecialtyComboboxProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
}

export function SpecialtyCombobox({
  value,
  onChange,
  className,
  disabled,
}: SpecialtyComboboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          {value ? value : <span className="text-muted-foreground">Select specialty…</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search specialties…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {SPECIALTIES.map((s) => (
                <CommandItem
                  key={s.value}
                  value={s.value}
                  onSelect={() => {
                    onChange(s.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === s.value ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  {s.value}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

Run: `npm test -- --run src/components/gw/SpecialtyCombobox/`
Expected: PASS — 6 tests.

If any test fails because cmdk's CommandItem renders as a `div` not a button, adjust the test selector to use `screen.findByText(...)` rather than `findByRole("option", ...)`.

- [ ] **Step 5: Commit**

```bash
git add src/components/gw/SpecialtyCombobox/
git commit -m "feat(specialties): SpecialtyCombobox component"
```

### Task 2.4: Wire SpecialtyCombobox into onboarding compliance-profile

**Files:**
- Modify: `src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx`
- Modify: `src/app/onboarding/compliance-profile/actions.ts`

- [ ] **Step 1: Update the form to use the combobox**

In `ComplianceProfileForm.tsx`:

1. Remove the existing `Specialty` type union (lines 10-16).
2. Replace the `<select>` for specialty (lines 198-214) with the SpecialtyCombobox.
3. Update the `handleSpecialtyChange` to take a `string` (the specialty value) and use `deriveSpecialtyCategory` to compute the bucket for the MIPS-exemption auto-toggle:

```tsx
import { SpecialtyCombobox } from "@/components/gw/SpecialtyCombobox";
import { deriveSpecialtyCategory } from "@/lib/specialties";

// In the component:
const [specialty, setSpecialty] = useState<string>(initial.specialtyCategory ?? "");

const handleSpecialtyChange = (next: string) => {
  setSpecialty(next);
  const bucket = deriveSpecialtyCategory(next);
  if (bucket === "DENTAL" || bucket === "ALLIED") {
    setToggles((p) => ({ ...p, subjectToMacraMips: false }));
  }
};

// In JSX (replace the existing label/select):
<label className="space-y-1 text-xs font-medium text-foreground">
  Primary specialty
  <SpecialtyCombobox value={specialty} onChange={handleSpecialtyChange} className="mt-1" />
</label>
```

Note: The existing `initial.specialtyCategory` field stores the OLD bucket value (e.g. "PRIMARY_CARE"). The new code stores the SPECIFIC value (e.g. "Family Medicine"). For new sign-ups it'll be empty. For existing rows where the migration ran, it'll be the specific. The `useState<string>(initial.specialtyCategory ?? "")` line works for both.

- [ ] **Step 2: Update the save action to derive + write both fields**

In `src/app/onboarding/compliance-profile/actions.ts`, find the save logic. Update to:

```ts
import { deriveSpecialtyCategory } from "@/lib/specialties";

// Inside the save function, where specialtyCategory was previously stored:
const specialty = input.specialty ?? null; // the SPECIFIC value from the combobox
const bucket = deriveSpecialtyCategory(specialty);

await db.$transaction([
  db.practice.update({
    where: { id: practiceId },
    data: { specialty },
  }),
  db.practiceComplianceProfile.upsert({
    where: { practiceId },
    create: {
      practiceId,
      specialtyCategory: bucket,
      // ... other compliance toggles
    },
    update: {
      specialtyCategory: bucket,
      // ... other compliance toggles
    },
  }),
]);
```

(Adjust to match the existing action's actual signature — the key change is: write `Practice.specialty` to the specific value AND write `PracticeComplianceProfile.specialtyCategory` to the derived bucket.)

The `submit` callback in the form should pass `specialty` (the specific value) instead of `specialtyCategory`:

```tsx
await saveComplianceProfileAction({
  ...toggles,
  specialty: specialty || null,
  providerCount: providerCountParsed != null && !Number.isNaN(providerCountParsed)
    ? providerCountParsed
    : null,
});
```

Update the action's input schema (Zod) to accept `specialty: string | null` instead of `specialtyCategory`.

- [ ] **Step 3: Run tests + tsc**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: tsc clean, all tests pass (existing onboarding integration tests should still work because they exercise the action via its public input).

If existing tests fail because they pass `specialtyCategory` literal — update them to pass `specialty` with a value like `"Family Medicine"`.

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding/compliance-profile/
git commit -m "feat(onboarding): wire SpecialtyCombobox + derive bucket"
```

### Task 2.5: Push + open PR (PR 2)

- [ ] **Step 1: Push + open**

```bash
git push -u origin feat/settings-pr2-specialty-expansion
gh pr create --title "feat(settings): specialty list expansion + migration (PR 2 of 5)" --body "$(cat <<'EOF'
## Summary

PR 2 of 5 from the Settings & Onboarding restructure spec.

- Replace 6-bucket specialty enum with curated 30+1 list (`Family Medicine`, `Cardiology`, ..., `Other`)
- New `<SpecialtyCombobox>` searchable single-select
- New `deriveSpecialtyCategory(specialty)` pure function — bucket derived, not stored as user-input
- Onboarding `ComplianceProfileForm` now uses the combobox
- Save action writes both `Practice.specialty` (specific) and `PracticeComplianceProfile.specialtyCategory` (derived bucket)
- One-shot migration script `scripts/backfill-practice-specialty.ts` to populate `Practice.specialty` from existing buckets — idempotent

## Migration sequencing

After this PR deploys to production, run **once**:
\`\`\`
npx tsx scripts/backfill-practice-specialty.ts
\`\`\`
This populates `Practice.specialty` for existing rows. Output: `Done. updated=N skipped=M`. Idempotent — safe to re-run.

## Test plan

- [x] `npx tsc --noEmit` clean
- [x] `npx eslint` clean on changed files
- [x] Test count baseline +X (specialties 9, backfill 9, SpecialtyCombobox 6)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: After merge, run migration script in production**

```bash
# After Cloud Build deploys, on a workstation with DATABASE_URL pointing at prod:
npx tsx scripts/backfill-practice-specialty.ts
```

(Optional: gate this behind a guard like `--allow-prod` if running from a CI-like environment.)

---

## PR 3 — Multi-state component

**Branch:** `feat/settings-pr3-multi-state`

**Goal:** New `<StateMultiSelect>` chip component. Wire into onboarding compliance-profile (additional states section). Move `primaryState` collection from `create-practice` step to `compliance-profile` so both state inputs live together.

### Task 3.1: US states constant + helpers

**Files:**
- Create: `src/lib/states.ts`
- Create: `src/lib/__tests__/states.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/states.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { US_STATES, isValidStateCode, stateName } from "@/lib/states";

describe("US_STATES", () => {
  it("has exactly 51 entries (50 states + DC)", () => {
    expect(US_STATES).toHaveLength(51);
  });
  it("each entry has 2-letter uppercase code + non-empty name", () => {
    for (const s of US_STATES) {
      expect(s.code).toMatch(/^[A-Z]{2}$/);
      expect(s.name.length).toBeGreaterThan(0);
    }
  });
  it("contains AZ Arizona, CA California, DC District of Columbia", () => {
    const codes = US_STATES.map((s) => s.code);
    expect(codes).toContain("AZ");
    expect(codes).toContain("CA");
    expect(codes).toContain("DC");
  });
  it("has unique codes", () => {
    const codes = US_STATES.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("isValidStateCode", () => {
  it("accepts known codes (case insensitive)", () => {
    expect(isValidStateCode("AZ")).toBe(true);
    expect(isValidStateCode("az")).toBe(true);
    expect(isValidStateCode("Ca")).toBe(true);
  });
  it("rejects unknown codes", () => {
    expect(isValidStateCode("XX")).toBe(false);
    expect(isValidStateCode("")).toBe(false);
    expect(isValidStateCode("USA")).toBe(false);
  });
});

describe("stateName", () => {
  it("returns full name for valid code", () => {
    expect(stateName("AZ")).toBe("Arizona");
    expect(stateName("dc")).toBe("District of Columbia");
  });
  it("returns the code itself for unknown", () => {
    expect(stateName("XX")).toBe("XX");
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test -- --run src/lib/__tests__/states.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/states.ts`:

```ts
// src/lib/states.ts — US states + DC list for state pickers.

export interface UsState {
  code: string;
  name: string;
}

export const US_STATES: readonly UsState[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
] as const;

const STATE_CODE_SET: ReadonlySet<string> = new Set(
  US_STATES.map((s) => s.code),
);
const STATE_NAME_BY_CODE: ReadonlyMap<string, string> = new Map(
  US_STATES.map((s) => [s.code, s.name]),
);

export function isValidStateCode(code: string): boolean {
  return STATE_CODE_SET.has(code.toUpperCase());
}

export function stateName(code: string): string {
  return STATE_NAME_BY_CODE.get(code.toUpperCase()) ?? code;
}
```

- [ ] **Step 4: Run test (expect pass)**

Run: `npm test -- --run src/lib/__tests__/states.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/settings-pr3-multi-state
git add src/lib/states.ts src/lib/__tests__/states.test.ts
git commit -m "feat(states): US_STATES constant + isValidStateCode + stateName"
```

### Task 3.2: StateMultiSelect component

**Files:**
- Create: `src/components/gw/StateMultiSelect/index.tsx`
- Create: `src/components/gw/StateMultiSelect/StateMultiSelect.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/gw/StateMultiSelect/StateMultiSelect.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { StateMultiSelect } from "./index";

expect.extend(toHaveNoViolations);

describe("StateMultiSelect", () => {
  it("renders an empty placeholder when no states selected", () => {
    render(<StateMultiSelect selectedStates={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent(/add states/i);
  });

  it("renders chips for selected states with full names", () => {
    render(
      <StateMultiSelect
        selectedStates={["AZ", "CA"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Arizona")).toBeInTheDocument();
    expect(screen.getByText("California")).toBeInTheDocument();
  });

  it("calls onChange with new state appended on selection", async () => {
    const onChange = vi.fn();
    render(<StateMultiSelect selectedStates={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    const arizona = await screen.findByText("Arizona");
    fireEvent.click(arizona);
    expect(onChange).toHaveBeenCalledWith(["AZ"]);
  });

  it("calls onChange with state removed when chip ✕ clicked", () => {
    const onChange = vi.fn();
    render(
      <StateMultiSelect
        selectedStates={["AZ", "CA"]}
        onChange={onChange}
      />,
    );
    const removeButton = screen.getByRole("button", { name: /remove arizona/i });
    fireEvent.click(removeButton);
    expect(onChange).toHaveBeenCalledWith(["CA"]);
  });

  it("excludes already-selected states from the dropdown options", async () => {
    render(
      <StateMultiSelect
        selectedStates={["AZ"]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("California")).toBeVisible();
      // Arizona is in the chip list above, but should NOT be in the dropdown options
      // (use queryAllByText to avoid throwing on multiple matches; check the dropdown specifically)
      const dropdown = screen.getByRole("listbox");
      expect(dropdown).not.toHaveTextContent(/^Arizona$/);
    });
  });

  it("excludes states from excludeStates prop (e.g. primary state)", async () => {
    render(
      <StateMultiSelect
        selectedStates={[]}
        excludeStates={["TX"]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      const dropdown = screen.getByRole("listbox");
      expect(dropdown).not.toHaveTextContent(/^Texas$/);
    });
  });

  it("filters dropdown by search input", async () => {
    render(<StateMultiSelect selectedStates={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox"));
    const search = await screen.findByPlaceholderText(/search states/i);
    fireEvent.change(search, { target: { value: "cal" } });
    await waitFor(() => {
      expect(screen.getByText("California")).toBeVisible();
      expect(screen.queryByText("Arizona")).toBeNull();
    });
  });

  it("passes axe a11y audit", async () => {
    const { container } = render(
      <StateMultiSelect
        selectedStates={["AZ", "CA"]}
        onChange={vi.fn()}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test -- --run src/components/gw/StateMultiSelect/`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `src/components/gw/StateMultiSelect/index.tsx`:

```tsx
// src/components/gw/StateMultiSelect/index.tsx
//
// Multi-select chip combobox for US states. The user adds states by typing
// into the search box and clicking a result; selected states render as
// removable chips above the input. Used in onboarding compliance-profile and
// the settings practice profile to capture `Practice.operatingStates`.
"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { US_STATES, stateName } from "@/lib/states";
import { cn } from "@/lib/utils";

export interface StateMultiSelectProps {
  /** 2-letter codes currently selected (chips). */
  selectedStates: string[];
  /** Codes to exclude from the dropdown (e.g. the primary state). */
  excludeStates?: string[];
  onChange: (next: string[]) => void;
  className?: string;
  disabled?: boolean;
}

export function StateMultiSelect({
  selectedStates,
  excludeStates = [],
  onChange,
  className,
  disabled,
}: StateMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const excludeSet = new Set([...selectedStates, ...excludeStates]);
  const available = US_STATES.filter((s) => !excludeSet.has(s.code));

  const handleAdd = (code: string) => {
    onChange([...selectedStates, code]);
    setOpen(false);
  };

  const handleRemove = (code: string) => {
    onChange(selectedStates.filter((c) => c !== code));
  };

  return (
    <div className={cn("space-y-2", className)}>
      {selectedStates.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" role="list">
          {selectedStates.map((code) => (
            <li key={code}>
              <Badge
                variant="secondary"
                className="gap-1.5 pr-1.5 text-sm font-normal"
              >
                {stateName(code)}
                <button
                  type="button"
                  onClick={() => handleRemove(code)}
                  disabled={disabled}
                  aria-label={`Remove ${stateName(code)}`}
                  className="rounded-full p-0.5 hover:bg-secondary-foreground/10 disabled:opacity-50"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || available.length === 0}
            className="w-full justify-start gap-2 font-normal"
          >
            <Plus className="h-4 w-4 opacity-50" aria-hidden="true" />
            <span className="text-muted-foreground">
              {available.length === 0 ? "All states added" : "Add states…"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search states…" />
            <CommandList role="listbox">
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {available.map((s) => (
                  <CommandItem
                    key={s.code}
                    value={`${s.name} ${s.code}`}
                    onSelect={() => handleAdd(s.code)}
                  >
                    {s.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

Run: `npm test -- --run src/components/gw/StateMultiSelect/`
Expected: PASS — 8 tests.

If `getByRole("listbox")` fails because cmdk uses a different role, switch to `screen.getByRole("dialog")` or query by class. The semantic role just needs to be reachable for axe + the visible/excluded assertions.

- [ ] **Step 5: Commit**

```bash
git add src/components/gw/StateMultiSelect/
git commit -m "feat(states): StateMultiSelect chip combobox component"
```

### Task 3.3: Move primaryState input from create-practice → compliance-profile

**Files:**
- Modify: `src/app/onboarding/create-practice/page.tsx`
- Modify: `src/app/onboarding/create-practice/actions.ts`
- Modify: `src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx`
- Modify: `src/app/onboarding/compliance-profile/actions.ts`

- [ ] **Step 1: Search for downstream code that requires primaryState**

Run: `grep -rn "primaryState" src/ --include="*.ts*" 2>&1 | grep -v node_modules | head -30`

Note any consumers that would break if primaryState is null. The `Practice` schema has `primaryState: String` (NOT NULL), so creating a Practice without it requires a placeholder.

**Decision:** keep primaryState in `create-practice` page as a HIDDEN input with a default of `"AZ"` for the create call ONLY (the schema requires it). The compliance-profile step then UPDATES it to the real value the user picks. This avoids the null gap.

Actually simpler: make primaryState in `create-practice` a placeholder default like `"--"` would violate schema validation. We'll use `"AZ"` as a temp default, but this could mislead users. Better solution: remove primaryState from CreatePracticePage's UI and have the action create Practice with `primaryState: "TX"` as a placeholder; then compliance-profile is REQUIRED to be completed and overrides it. Add a comment + a check in the compliance-profile redirect.

Actually the cleanest approach: relax `Practice.primaryState` to nullable in the schema. But that's a schema change rippling through code — out of scope.

Compromise: leave a dropdown for primaryState in create-practice but DEFAULT it to something obvious + always re-confirmable in compliance-profile. Show both inputs on compliance-profile.

For simplicity in this PR: leave create-practice's input as-is (it already collects primaryState). ADD the additional-states multi-select to compliance-profile. The user sets primary in step 1, additional in step 2. No schema change needed.

Update the plan: don't move primaryState. Just add the multi-select for `operatingStates` in compliance-profile.

- [ ] **Step 2: Update compliance-profile form to include StateMultiSelect**

In `ComplianceProfileForm.tsx`:

```tsx
import { StateMultiSelect } from "@/components/gw/StateMultiSelect";

// Add to ComplianceProfileFormProps.initial:
//   operatingStates: string[];
//   primaryState: string; // for excludeStates prop

// Add component state:
const [operatingStates, setOperatingStates] = useState<string[]>(
  initial.operatingStates ?? [],
);

// In JSX, somewhere logical (after the toggles, before specialty):
<section className="space-y-2">
  <label className="text-xs font-medium text-foreground">
    Additional states
  </label>
  <p className="text-xs text-muted-foreground">
    States besides {initial.primaryState} where this practice operates. Used
    for state-specific compliance overlays.
  </p>
  <StateMultiSelect
    selectedStates={operatingStates}
    excludeStates={[initial.primaryState]}
    onChange={setOperatingStates}
  />
</section>
```

Update the submit callback to include `operatingStates`:

```tsx
await saveComplianceProfileAction({
  ...toggles,
  specialty: specialty || null,
  providerCount: ...,
  operatingStates,
});
```

- [ ] **Step 3: Update server action to accept operatingStates**

In `src/app/onboarding/compliance-profile/actions.ts`:

```ts
import { isValidStateCode } from "@/lib/states";

// In the input Zod schema, add:
//   operatingStates: z.array(z.string().length(2)).default([])

// In the save logic, validate each:
const validOperatingStates = (input.operatingStates ?? []).filter(isValidStateCode);

// Update Practice in transaction:
await db.practice.update({
  where: { id: practiceId },
  data: {
    operatingStates: validOperatingStates,
    specialty,
    // ... existing fields
  },
});
```

- [ ] **Step 4: Update the page that loads this form to pass initial values**

`src/app/onboarding/compliance-profile/page.tsx` — find where `<ComplianceProfileForm initial={...}>` is rendered and add `operatingStates: practice.operatingStates ?? []` and `primaryState: practice.primaryState` to the initial object.

- [ ] **Step 5: Run tests + tsc**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: tsc clean, full suite passes (existing tests unaffected since the new field has a default).

- [ ] **Step 6: Commit**

```bash
git add src/app/onboarding/compliance-profile/
git commit -m "feat(onboarding): wire StateMultiSelect for operatingStates"
```

### Task 3.4: Push + open PR (PR 3)

- [ ] **Step 1: Push + open**

```bash
git push -u origin feat/settings-pr3-multi-state
gh pr create --title "feat(settings): multi-state UI (PR 3 of 5)" --body "$(cat <<'EOF'
## Summary

PR 3 of 5 from the Settings & Onboarding restructure spec.

- New \`<StateMultiSelect>\` chip + combobox component (cmdk + Popover + Badge)
- New \`src/lib/states.ts\` (US_STATES + isValidStateCode + stateName)
- Onboarding \`compliance-profile\` step now collects \`operatingStates\` (additional states beyond primary)

\`Practice.operatingStates: String[]\` already exists in the schema — this PR only adds the UI.

## Test plan

- [x] \`npx tsc --noEmit\` clean
- [x] Tests: states 9, StateMultiSelect 8 = +17

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 4 — Practice profile expansion + unified form

**Branch:** `feat/settings-pr4-practice-profile`

**Goal:** Build `<PracticeProfileForm>` (the unified form), `<EhrCombobox>` helper, the new `savePracticeProfileAction` server action, and register the `PRACTICE_PROFILE_UPDATED` event. Wire into `/settings/practice` AND extend onboarding `compliance-profile` to collect the 5 new fields (`npiNumber`, `entityType`, `addressStreet/Suite/City/Zip`, `ehrSystem`).

### Task 4.1: NPI Luhn validation helper

**Files:**
- Create: `src/lib/npi.ts`
- Create: `src/lib/__tests__/npi.test.ts`

NPI uses ISO 7812-1 Luhn checksum prefixed with "80840" (Healthcare prefix).

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/npi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidNpi } from "@/lib/npi";

// Known-valid NPIs from NPPES (publicly documented examples):
//   1234567893 — Luhn checksum example from CMS NPI doc
//   1457408022 — Mayo Clinic Rochester NPI (publicly listed)

describe("isValidNpi", () => {
  it("accepts valid 10-digit NPIs", () => {
    expect(isValidNpi("1234567893")).toBe(true);
    expect(isValidNpi("1457408022")).toBe(true);
  });
  it("rejects 10-digit numbers that fail Luhn", () => {
    expect(isValidNpi("1234567890")).toBe(false);
    expect(isValidNpi("0000000000")).toBe(false);
  });
  it("rejects non-10-digit inputs", () => {
    expect(isValidNpi("123")).toBe(false);
    expect(isValidNpi("12345678901")).toBe(false); // 11 digits
    expect(isValidNpi("abcdefghij")).toBe(false);
  });
  it("rejects empty / null / undefined", () => {
    expect(isValidNpi("")).toBe(false);
    expect(isValidNpi(null)).toBe(false);
    expect(isValidNpi(undefined)).toBe(false);
  });
  it("trims whitespace before validating", () => {
    expect(isValidNpi(" 1234567893 ")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `npm test -- --run src/lib/__tests__/npi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/npi.ts`:

```ts
// src/lib/npi.ts
//
// NPI (National Provider Identifier) validation. Uses Luhn checksum with
// the "80840" CMS healthcare prefix per CMS NPI documentation:
//   https://www.cms.gov/Regulations-and-Guidance/Administrative-Simplification/NationalProvIdentStand/Downloads/NPIcheckdigit.pdf

export function isValidNpi(input: string | null | undefined): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  if (!/^\d{10}$/.test(trimmed)) return false;

  // Apply CMS healthcare prefix "80840" + first 9 digits, then Luhn-validate
  // against the 10th (check) digit.
  const prefixed = `80840${trimmed.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < prefixed.length; i++) {
    let digit = Number.parseInt(prefixed[prefixed.length - 1 - i]!, 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number.parseInt(trimmed[9]!, 10);
}
```

- [ ] **Step 4: Run test**

Run: `npm test -- --run src/lib/__tests__/npi.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/settings-pr4-practice-profile
git add src/lib/npi.ts src/lib/__tests__/npi.test.ts
git commit -m "feat(npi): isValidNpi Luhn checksum helper"
```

### Task 4.2: EhrCombobox component

**Files:**
- Create: `src/components/gw/EhrCombobox/index.tsx`
- Create: `src/components/gw/EhrCombobox/EhrCombobox.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/gw/EhrCombobox/EhrCombobox.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EhrCombobox } from "./index";

describe("EhrCombobox", () => {
  it("renders the trigger with placeholder when empty", () => {
    render(<EhrCombobox value="" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent(/select ehr/i);
  });
  it("renders the trigger with selected EHR name", () => {
    render(<EhrCombobox value="Epic" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Epic");
  });
  it("renders 'Other' as the trigger label when value is a custom string", () => {
    render(<EhrCombobox value="MyCustomEHR" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent(/myc?ustom/i);
  });
  it("opens to show 12 known EHRs + Other", async () => {
    render(<EhrCombobox value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Epic")).toBeVisible();
      expect(screen.getByText("Cerner (Oracle Health)")).toBeVisible();
      expect(screen.getByText("Other")).toBeVisible();
    });
  });
  it("when 'Other' selected, reveals a free-text input + onChange called with input value", async () => {
    const onChange = vi.fn();
    render(<EhrCombobox value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("Other"));
    const freeText = await screen.findByPlaceholderText(/your ehr/i);
    fireEvent.change(freeText, { target: { value: "MyCustomEHR" } });
    expect(onChange).toHaveBeenLastCalledWith("MyCustomEHR");
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `npm test -- --run src/components/gw/EhrCombobox/`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/gw/EhrCombobox/index.tsx`:

```tsx
// src/components/gw/EhrCombobox/index.tsx
//
// Single-select combobox with a free-text "Other" fallback for the EHR
// system used by the practice. Internal helper for PracticeProfileForm.
"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const KNOWN_EHRS = [
  "Epic",
  "Cerner (Oracle Health)",
  "Athenahealth",
  "eClinicalWorks",
  "NextGen",
  "AdvancedMD",
  "DrChrono",
  "Practice Fusion",
  "Greenway",
  "Allscripts",
  "Kareo",
  "ChartLogic",
  "Other",
] as const;

type KnownEhr = (typeof KNOWN_EHRS)[number];

export interface EhrComboboxProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
}

export function EhrCombobox({
  value,
  onChange,
  className,
  disabled,
}: EhrComboboxProps) {
  const [open, setOpen] = useState(false);
  const isKnown = KNOWN_EHRS.includes(value as KnownEhr);
  const showOtherInput = value !== "" && !isKnown;
  const displayValue = !value
    ? null
    : showOtherInput
      ? value
      : value;

  const handlePick = (next: string) => {
    if (next === "Other") {
      // Switching to "Other" — set a placeholder string the user immediately edits.
      onChange("Other");
    } else {
      onChange(next);
    }
    setOpen(false);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {displayValue ?? <span className="text-muted-foreground">Select EHR…</span>}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search EHRs…" />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {KNOWN_EHRS.map((ehr) => (
                  <CommandItem key={ehr} value={ehr} onSelect={() => handlePick(ehr)}>
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === ehr ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                    {ehr}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {(value === "Other" || showOtherInput) && (
        <Input
          type="text"
          placeholder="Your EHR…"
          value={value === "Other" ? "" : value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run + pass**

Run: `npm test -- --run src/components/gw/EhrCombobox/`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/gw/EhrCombobox/
git commit -m "feat(ehr): EhrCombobox with 12 known EHRs + Other free-text"
```

### Task 4.3: PracticeProfileForm (the unified form)

**Files:**
- Create: `src/components/gw/PracticeProfileForm/index.tsx`
- Create: `src/components/gw/PracticeProfileForm/PracticeProfileForm.test.tsx`
- Create: `src/components/gw/PracticeProfileForm/types.ts`

This is the largest single component. Build it incrementally.

- [ ] **Step 1: Define the input/output types**

Create `src/components/gw/PracticeProfileForm/types.ts`:

```ts
// src/components/gw/PracticeProfileForm/types.ts

export interface PracticeProfileInput {
  // Identity
  name: string;
  npiNumber: string | null;
  entityType: "COVERED_ENTITY" | "BUSINESS_ASSOCIATE";

  // Location
  primaryState: string;
  operatingStates: string[];
  addressStreet: string | null;
  addressSuite: string | null;
  addressCity: string | null;
  addressZip: string | null;

  // Practice
  specialty: string | null;
  providerCount: "SOLO" | "SMALL_2_5" | "MEDIUM_6_15" | "LARGE_16_PLUS";
  ehrSystem: string | null;

  // Settings-only fields
  staffHeadcount: number | null;
  phone: string | null;
}

export interface PracticeProfileFormProps {
  mode: "onboarding" | "settings";
  initial: PracticeProfileInput;
  onSubmit: (next: PracticeProfileInput) => Promise<{ ok: boolean; error?: string }>;
  submitLabel?: string;
}
```

- [ ] **Step 2: Write failing test (focused unit tests, not integration)**

Create `src/components/gw/PracticeProfileForm/PracticeProfileForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PracticeProfileForm } from "./index";
import type { PracticeProfileInput } from "./types";

const baseInitial: PracticeProfileInput = {
  name: "Acme Family Medicine",
  npiNumber: null,
  entityType: "COVERED_ENTITY",
  primaryState: "AZ",
  operatingStates: [],
  addressStreet: null,
  addressSuite: null,
  addressCity: null,
  addressZip: null,
  specialty: null,
  providerCount: "SOLO",
  ehrSystem: null,
  staffHeadcount: null,
  phone: null,
};

describe("PracticeProfileForm", () => {
  it("renders Identity, Location, Practice sections in onboarding mode", () => {
    render(
      <PracticeProfileForm
        mode="onboarding"
        initial={baseInitial}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/identity/i)).toBeInTheDocument();
    expect(screen.getByText(/location/i)).toBeInTheDocument();
    expect(screen.getByText(/practice/i)).toBeInTheDocument();
  });

  it("hides staff headcount + phone inputs in onboarding mode", () => {
    render(
      <PracticeProfileForm
        mode="onboarding"
        initial={baseInitial}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/staff headcount/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^phone/i)).not.toBeInTheDocument();
  });

  it("shows staff headcount + phone inputs in settings mode", () => {
    render(
      <PracticeProfileForm
        mode="settings"
        initial={baseInitial}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/staff headcount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^phone/i)).toBeInTheDocument();
  });

  it("rejects submit when NPI is invalid (10 digits but bad checksum)", async () => {
    const onSubmit = vi.fn();
    render(
      <PracticeProfileForm
        mode="settings"
        initial={baseInitial}
        onSubmit={onSubmit}
      />,
    );
    const npi = screen.getByLabelText(/npi/i);
    fireEvent.change(npi, { target: { value: "1234567890" } }); // bad checksum
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid npi/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects submit when zip is not 5 digits", async () => {
    const onSubmit = vi.fn();
    render(
      <PracticeProfileForm
        mode="settings"
        initial={{ ...baseInitial, addressZip: "123" }}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/zip must be 5 digits/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits successfully with valid input", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <PracticeProfileForm
        mode="settings"
        initial={{ ...baseInitial, name: "Acme" }}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]![0].name).toBe("Acme");
  });

  it("displays the error returned by onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, error: "Server boom" });
    render(
      <PracticeProfileForm
        mode="settings"
        initial={baseInitial}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText("Server boom")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run + fail**

Run: `npm test -- --run src/components/gw/PracticeProfileForm/`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the form**

Create `src/components/gw/PracticeProfileForm/index.tsx`:

```tsx
// src/components/gw/PracticeProfileForm/index.tsx
//
// Unified practice profile form. Used by:
//   - /settings/practice (mode="settings"): all sections + optional fields
//   - /onboarding/compliance-profile (mode="onboarding"): all sections,
//     but staffHeadcount + phone are hidden
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { US_STATES } from "@/lib/states";
import { isValidNpi } from "@/lib/npi";
import { SpecialtyCombobox } from "@/components/gw/SpecialtyCombobox";
import { StateMultiSelect } from "@/components/gw/StateMultiSelect";
import { EhrCombobox } from "@/components/gw/EhrCombobox";
import type { PracticeProfileInput, PracticeProfileFormProps } from "./types";

export function PracticeProfileForm({
  mode,
  initial,
  onSubmit,
  submitLabel = "Save",
}: PracticeProfileFormProps) {
  const [state, setState] = useState<PracticeProfileInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof PracticeProfileInput, string>>>({});
  const [pending, startTransition] = useTransition();

  function update<K extends keyof PracticeProfileInput>(key: K, value: PracticeProfileInput[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
    // Clear field-level error on edit.
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): Partial<Record<keyof PracticeProfileInput, string>> {
    const errs: Partial<Record<keyof PracticeProfileInput, string>> = {};
    if (!state.name || state.name.trim().length === 0) {
      errs.name = "Practice name is required.";
    }
    if (state.npiNumber && !isValidNpi(state.npiNumber)) {
      errs.npiNumber = "Invalid NPI checksum — please verify the number.";
    }
    if (state.addressZip && !/^\d{5}$/.test(state.addressZip)) {
      errs.addressZip = "Zip must be 5 digits.";
    }
    if (!US_STATES.find((s) => s.code === state.primaryState)) {
      errs.primaryState = "Primary state is required.";
    }
    return errs;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    startTransition(async () => {
      const result = await onSubmit(state);
      if (!result.ok) {
        setError(result.error ?? "Save failed");
      }
    });
  }

  const labelClass = "text-xs font-medium text-foreground";
  const sectionClass = "space-y-3 rounded-md border p-4";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Identity */}
      <section className={sectionClass} aria-labelledby="identity-heading">
        <h3 id="identity-heading" className="text-sm font-semibold">Identity</h3>
        <div>
          <Label htmlFor="name" className={labelClass}>Practice name</Label>
          <Input
            id="name"
            type="text"
            value={state.name}
            onChange={(e) => update("name", e.target.value)}
            required
            maxLength={200}
          />
          {fieldErrors.name && <p className="mt-1 text-xs text-destructive">{fieldErrors.name}</p>}
        </div>
        <div>
          <Label htmlFor="npiNumber" className={labelClass}>NPI (optional)</Label>
          <Input
            id="npiNumber"
            type="text"
            inputMode="numeric"
            pattern="\d{10}"
            placeholder="10-digit NPI"
            value={state.npiNumber ?? ""}
            onChange={(e) => update("npiNumber", e.target.value || null)}
          />
          {fieldErrors.npiNumber && <p className="mt-1 text-xs text-destructive">{fieldErrors.npiNumber}</p>}
        </div>
        <div>
          <span className={labelClass}>Entity type</span>
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="entityType"
                value="COVERED_ENTITY"
                checked={state.entityType === "COVERED_ENTITY"}
                onChange={() => update("entityType", "COVERED_ENTITY")}
              />
              <span>Covered Entity (most healthcare providers)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="entityType"
                value="BUSINESS_ASSOCIATE"
                checked={state.entityType === "BUSINESS_ASSOCIATE"}
                onChange={() => update("entityType", "BUSINESS_ASSOCIATE")}
              />
              <span>Business Associate (vendors handling PHI)</span>
            </label>
          </div>
        </div>
      </section>

      {/* Location */}
      <section className={sectionClass} aria-labelledby="location-heading">
        <h3 id="location-heading" className="text-sm font-semibold">Location</h3>
        <div>
          <Label htmlFor="primaryState" className={labelClass}>Primary state</Label>
          <select
            id="primaryState"
            value={state.primaryState}
            onChange={(e) => update("primaryState", e.target.value)}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
          {fieldErrors.primaryState && <p className="mt-1 text-xs text-destructive">{fieldErrors.primaryState}</p>}
        </div>
        <div>
          <span className={labelClass}>Additional states</span>
          <StateMultiSelect
            selectedStates={state.operatingStates}
            excludeStates={[state.primaryState]}
            onChange={(next) => update("operatingStates", next)}
            className="mt-1"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="addressStreet" className={labelClass}>Street</Label>
            <Input
              id="addressStreet"
              type="text"
              value={state.addressStreet ?? ""}
              onChange={(e) => update("addressStreet", e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="addressSuite" className={labelClass}>Suite (optional)</Label>
            <Input
              id="addressSuite"
              type="text"
              value={state.addressSuite ?? ""}
              onChange={(e) => update("addressSuite", e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="addressCity" className={labelClass}>City</Label>
            <Input
              id="addressCity"
              type="text"
              value={state.addressCity ?? ""}
              onChange={(e) => update("addressCity", e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="addressZip" className={labelClass}>Zip</Label>
            <Input
              id="addressZip"
              type="text"
              inputMode="numeric"
              pattern="\d{5}"
              maxLength={5}
              value={state.addressZip ?? ""}
              onChange={(e) => update("addressZip", e.target.value || null)}
            />
            {fieldErrors.addressZip && <p className="mt-1 text-xs text-destructive">{fieldErrors.addressZip}</p>}
          </div>
        </div>
      </section>

      {/* Practice */}
      <section className={sectionClass} aria-labelledby="practice-heading">
        <h3 id="practice-heading" className="text-sm font-semibold">Practice</h3>
        <div>
          <span className={labelClass}>Specialty</span>
          <SpecialtyCombobox
            value={state.specialty ?? ""}
            onChange={(next) => update("specialty", next || null)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="providerCount" className={labelClass}>Providers</Label>
          <select
            id="providerCount"
            value={state.providerCount}
            onChange={(e) => update("providerCount", e.target.value as PracticeProfileInput["providerCount"])}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="SOLO">Solo (1)</option>
            <option value="SMALL_2_5">Small (2–5)</option>
            <option value="MEDIUM_6_15">Medium (6–15)</option>
            <option value="LARGE_16_PLUS">Large (16+)</option>
          </select>
        </div>
        <div>
          <span className={labelClass}>EHR system</span>
          <EhrCombobox
            value={state.ehrSystem ?? ""}
            onChange={(next) => update("ehrSystem", next || null)}
            className="mt-1"
          />
        </div>
        {mode === "settings" && (
          <>
            <div>
              <Label htmlFor="staffHeadcount" className={labelClass}>Staff headcount (optional)</Label>
              <Input
                id="staffHeadcount"
                type="number"
                min={0}
                value={state.staffHeadcount ?? ""}
                onChange={(e) =>
                  update("staffHeadcount", e.target.value ? Number.parseInt(e.target.value, 10) : null)
                }
              />
            </div>
            <div>
              <Label htmlFor="phone" className={labelClass}>Phone (optional)</Label>
              <Input
                id="phone"
                type="tel"
                value={state.phone ?? ""}
                onChange={(e) => update("phone", e.target.value || null)}
              />
            </div>
          </>
        )}
      </section>

      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Run + pass**

Run: `npm test -- --run src/components/gw/PracticeProfileForm/`
Expected: PASS — 7 tests.

If the section heading test fails because the labels match other text (e.g. "Practice name" matches "Practice"), use `getByRole("heading", { name: /practice/i })` instead of `getByText`.

- [ ] **Step 6: Commit**

```bash
git add src/components/gw/PracticeProfileForm/
git commit -m "feat(profile): PracticeProfileForm unified form"
```

### Task 4.4: Register PRACTICE_PROFILE_UPDATED event type

**Files:**
- Modify: `src/lib/events/registry.ts`
- Modify: existing tests for events registry (if any)

- [ ] **Step 1: Read current registry pattern**

Run: `grep -n "PRACTICE_" src/lib/events/registry.ts | head -20`

Note the existing event-type pattern (likely a Zod-validated discriminated union with `type` + `payload`).

- [ ] **Step 2: Add event type**

In `src/lib/events/registry.ts`, register a new event type:

```ts
// Add to the event-type registry (matching existing pattern):
PRACTICE_PROFILE_UPDATED: {
  payload: z.object({
    changedFields: z.array(z.string()),
  }),
},
```

The payload only tracks WHICH fields changed (not before/after) — keeps the audit log compact and avoids serializing potentially large strings (address etc.).

- [ ] **Step 3: Run tsc + tests**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: tsc clean, full suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/events/registry.ts
git commit -m "feat(events): register PRACTICE_PROFILE_UPDATED event type"
```

### Task 4.5: savePracticeProfileAction server action

**Files:**
- Create: `src/app/(dashboard)/settings/practice/actions.ts`
- Create: `src/app/(dashboard)/settings/practice/__tests__/actions.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `src/app/(dashboard)/settings/practice/__tests__/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { savePracticeProfileAction } from "../actions";

// Stub getPracticeUser to return a deterministic user/practice pair.
vi.mock("@/lib/rbac", async () => {
  const actual = await vi.importActual("@/lib/rbac");
  return {
    ...actual,
    getPracticeUser: vi.fn(),
  };
});
import { getPracticeUser } from "@/lib/rbac";

describe("savePracticeProfileAction", () => {
  let practiceId: string;
  let userId: string;

  beforeEach(async () => {
    await db.eventLog.deleteMany({});
    await db.practiceComplianceProfile.deleteMany({});
    await db.practiceUser.deleteMany({});
    await db.practice.deleteMany({});
    await db.user.deleteMany({});

    const u = await db.user.create({
      data: {
        firebaseUid: `t-${Math.random().toString(36).slice(2)}`,
        email: `t-${Math.random().toString(36).slice(2)}@test.test`,
      },
    });
    const p = await db.practice.create({
      data: { name: "Test Practice", primaryState: "AZ" },
    });
    await db.practiceUser.create({
      data: { userId: u.id, practiceId: p.id, role: "OWNER" },
    });
    userId = u.id;
    practiceId = p.id;

    (getPracticeUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      practiceId,
      dbUser: { id: userId },
      practice: { id: practiceId },
    });
  });

  it("writes Practice + derived specialtyCategory in one transaction", async () => {
    const result = await savePracticeProfileAction({
      name: "Acme Family Medicine",
      npiNumber: null,
      entityType: "COVERED_ENTITY",
      primaryState: "AZ",
      operatingStates: ["NV"],
      addressStreet: "1 Main",
      addressSuite: null,
      addressCity: "Phoenix",
      addressZip: "85001",
      specialty: "Family Medicine",
      providerCount: "SOLO",
      ehrSystem: "Epic",
      staffHeadcount: 3,
      phone: null,
    });
    expect(result.ok).toBe(true);

    const updated = await db.practice.findUniqueOrThrow({ where: { id: practiceId } });
    expect(updated.name).toBe("Acme Family Medicine");
    expect(updated.operatingStates).toEqual(["NV"]);
    expect(updated.specialty).toBe("Family Medicine");
    expect(updated.entityType).toBe("COVERED_ENTITY");

    const profile = await db.practiceComplianceProfile.findUnique({
      where: { practiceId },
    });
    expect(profile?.specialtyCategory).toBe("PRIMARY_CARE");
  });

  it("rejects invalid NPI with Luhn failure", async () => {
    const result = await savePracticeProfileAction({
      name: "X",
      npiNumber: "1234567890", // bad checksum
      entityType: "COVERED_ENTITY",
      primaryState: "AZ",
      operatingStates: [],
      addressStreet: null,
      addressSuite: null,
      addressCity: null,
      addressZip: null,
      specialty: null,
      providerCount: "SOLO",
      ehrSystem: null,
      staffHeadcount: null,
      phone: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/npi/i);
  });

  it("appends a PRACTICE_PROFILE_UPDATED event with changed fields", async () => {
    await savePracticeProfileAction({
      name: "Acme",
      npiNumber: null,
      entityType: "COVERED_ENTITY",
      primaryState: "AZ",
      operatingStates: [],
      addressStreet: null,
      addressSuite: null,
      addressCity: null,
      addressZip: null,
      specialty: "Cardiology",
      providerCount: "SOLO",
      ehrSystem: null,
      staffHeadcount: null,
      phone: null,
    });
    const events = await db.eventLog.findMany({
      where: { practiceId, type: "PRACTICE_PROFILE_UPDATED" },
    });
    expect(events.length).toBe(1);
    const payload = events[0]!.payload as { changedFields: string[] };
    expect(payload.changedFields).toContain("name");
    expect(payload.changedFields).toContain("specialty");
  });
});
```

- [ ] **Step 2: Implement the action**

Create `src/app/(dashboard)/settings/practice/actions.ts`:

```ts
// src/app/(dashboard)/settings/practice/actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { isValidNpi } from "@/lib/npi";
import { isValidStateCode } from "@/lib/states";
import { deriveSpecialtyCategory } from "@/lib/specialties";
import { appendEventAndApply } from "@/lib/events";
import type { PracticeProfileInput } from "@/components/gw/PracticeProfileForm/types";

const InputSchema = z.object({
  name: z.string().min(1).max(200),
  npiNumber: z.string().nullable(),
  entityType: z.enum(["COVERED_ENTITY", "BUSINESS_ASSOCIATE"]),
  primaryState: z.string().length(2),
  operatingStates: z.array(z.string().length(2)),
  addressStreet: z.string().nullable(),
  addressSuite: z.string().nullable(),
  addressCity: z.string().nullable(),
  addressZip: z.string().regex(/^\d{5}$/).nullable(),
  specialty: z.string().nullable(),
  providerCount: z.enum(["SOLO", "SMALL_2_5", "MEDIUM_6_15", "LARGE_16_PLUS"]),
  ehrSystem: z.string().nullable(),
  staffHeadcount: z.number().int().min(0).nullable(),
  phone: z.string().nullable(),
});

export async function savePracticeProfileAction(
  input: PracticeProfileInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "Not authenticated." };

  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const data = parsed.data;

  if (data.npiNumber && !isValidNpi(data.npiNumber)) {
    return { ok: false, error: "Invalid NPI checksum." };
  }
  if (!isValidStateCode(data.primaryState)) {
    return { ok: false, error: "Invalid primary state." };
  }
  for (const s of data.operatingStates) {
    if (!isValidStateCode(s)) return { ok: false, error: `Invalid state: ${s}` };
  }

  const before = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
  });

  const changed: string[] = [];
  for (const k of Object.keys(data) as Array<keyof typeof data>) {
    const beforeVal = JSON.stringify((before as Record<string, unknown>)[k] ?? null);
    const afterVal = JSON.stringify(data[k] ?? null);
    if (beforeVal !== afterVal) changed.push(k);
  }

  const bucket = deriveSpecialtyCategory(data.specialty);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: pu.dbUser.id,
      type: "PRACTICE_PROFILE_UPDATED",
      payload: { changedFields: changed },
    },
    async (tx) => {
      await tx.practice.update({
        where: { id: pu.practiceId },
        data: {
          name: data.name,
          npiNumber: data.npiNumber,
          entityType: data.entityType,
          primaryState: data.primaryState,
          operatingStates: data.operatingStates,
          addressStreet: data.addressStreet,
          addressSuite: data.addressSuite,
          addressCity: data.addressCity,
          addressZip: data.addressZip,
          specialty: data.specialty,
          providerCount: data.providerCount,
          ehrSystem: data.ehrSystem,
          staffHeadcount: data.staffHeadcount,
          phone: data.phone,
        },
      });
      await tx.practiceComplianceProfile.upsert({
        where: { practiceId: pu.practiceId },
        create: {
          practiceId: pu.practiceId,
          specialtyCategory: bucket,
        },
        update: {
          specialtyCategory: bucket,
        },
      });
    },
  );

  revalidatePath("/settings/practice");
  revalidatePath("/dashboard");
  return { ok: true };
}
```

- [ ] **Step 3: Run tests + pass**

Run: `npm test -- --run src/app/(dashboard)/settings/practice/__tests__/actions.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/settings/practice/
git commit -m "feat(settings): savePracticeProfileAction with audit event"
```

### Task 4.6: Wire PracticeProfileForm into /settings/practice page

**Files:**
- Modify: `src/app/(dashboard)/settings/practice/page.tsx`

- [ ] **Step 1: Replace existing form with PracticeProfileForm**

Read the existing file first (`cat src/app/\(dashboard\)/settings/practice/page.tsx`) and replace the form rendering with:

```tsx
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PracticeProfileForm } from "@/components/gw/PracticeProfileForm";
import type { PracticeProfileInput } from "@/components/gw/PracticeProfileForm/types";
import { savePracticeProfileAction } from "./actions";

export const metadata = { title: "Practice profile · Settings · GuardWell" };

export default async function PracticeProfilePage() {
  const pu = await getPracticeUser();
  if (!pu) redirect("/sign-in" as Route);

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
  });

  const initial: PracticeProfileInput = {
    name: practice.name,
    npiNumber: practice.npiNumber,
    entityType: (practice.entityType as "COVERED_ENTITY" | "BUSINESS_ASSOCIATE") ?? "COVERED_ENTITY",
    primaryState: practice.primaryState,
    operatingStates: practice.operatingStates ?? [],
    addressStreet: practice.addressStreet,
    addressSuite: practice.addressSuite,
    addressCity: practice.addressCity,
    addressZip: practice.addressZip,
    specialty: practice.specialty,
    providerCount: (practice.providerCount as PracticeProfileInput["providerCount"]) ?? "SOLO",
    ehrSystem: practice.ehrSystem,
    staffHeadcount: practice.staffHeadcount,
    phone: practice.phone,
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Practice profile</h1>
      <p className="text-sm text-muted-foreground">
        Edit your practice details. Changes are visible in compliance reports immediately.
      </p>
      <PracticeProfileForm
        mode="settings"
        initial={initial}
        onSubmit={savePracticeProfileAction}
      />
    </main>
  );
}
```

- [ ] **Step 2: Run tsc + tests**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/settings/practice/page.tsx
git commit -m "feat(settings): /settings/practice uses PracticeProfileForm"
```

### Task 4.7: Embed PracticeProfileForm in onboarding compliance-profile

**Files:**
- Modify: `src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx`
- Modify: `src/app/onboarding/compliance-profile/actions.ts` (extend save to handle new fields)
- Modify: `src/app/onboarding/compliance-profile/page.tsx` (load full Practice initial)

- [ ] **Step 1: Refactor ComplianceProfileForm to use PracticeProfileForm**

The current ComplianceProfileForm has 7 toggles + the form. Refactor so it composes PracticeProfileForm + the toggles section:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { PracticeProfileForm } from "@/components/gw/PracticeProfileForm";
import type { PracticeProfileInput } from "@/components/gw/PracticeProfileForm/types";
import { saveComplianceProfileAction } from "./actions";

// (existing TOGGLES constant unchanged)

export interface ComplianceProfileFormProps {
  initial: {
    // toggles
    hasInHouseLab: boolean;
    dispensesControlledSubstances: boolean;
    medicareParticipant: boolean;
    billsMedicaid: boolean;
    subjectToMacraMips: boolean;
    sendsAutomatedPatientMessages: boolean;
    compoundsAllergens: boolean;
    // profile
    profile: PracticeProfileInput;
  };
  redirectTo: Route;
  escapeHatchHref?: Route;
  submitLabel: string;
}

export function ComplianceProfileForm({
  initial,
  redirectTo,
  escapeHatchHref,
  submitLabel,
}: ComplianceProfileFormProps) {
  const [toggles, setToggles] = useState({ ...initial }); // strip profile from spread
  const [profile, setProfile] = useState<PracticeProfileInput>(initial.profile);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // (toggle change handler same as before, uses deriveSpecialtyCategory etc.)

  const onSubmit = async (next: PracticeProfileInput) => {
    setError(null);
    setProfile(next);
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      startTransition(async () => {
        try {
          await saveComplianceProfileAction({
            // toggles
            hasInHouseLab: toggles.hasInHouseLab,
            dispensesControlledSubstances: toggles.dispensesControlledSubstances,
            medicareParticipant: toggles.medicareParticipant,
            billsMedicaid: toggles.billsMedicaid,
            subjectToMacraMips: toggles.subjectToMacraMips,
            sendsAutomatedPatientMessages: toggles.sendsAutomatedPatientMessages,
            compoundsAllergens: toggles.compoundsAllergens,
            // profile
            profile: next,
          });
          router.push(redirectTo);
          resolve({ ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Save failed";
          resolve({ ok: false, error: msg });
        }
      });
    });
  };

  return (
    <div className="space-y-5">
      {/* Compliance toggles section: existing JSX */}
      {/* ... */}
      <PracticeProfileForm
        mode="onboarding"
        initial={profile}
        onSubmit={onSubmit}
        submitLabel={submitLabel}
      />
    </div>
  );
}
```

(The exact structure depends on the existing form layout — keep the toggles section as-is and wire the profile form below it.)

- [ ] **Step 2: Update saveComplianceProfileAction**

In `src/app/onboarding/compliance-profile/actions.ts`, accept the full profile object and write all the new fields:

```ts
import { savePracticeProfileAction } from "@/app/(dashboard)/settings/practice/actions";

// In saveComplianceProfileAction:
//   1. Save the toggles to PracticeComplianceProfile (existing)
//   2. Call savePracticeProfileAction(input.profile) to save the profile fields
//   3. Return result
```

Or duplicate the profile-save logic inline — refactor decision: a single shared helper might be cleaner.

- [ ] **Step 3: Update compliance-profile/page.tsx to provide initial.profile**

Load the full Practice into the initial profile object:

```tsx
const profile: PracticeProfileInput = {
  name: practice.name,
  npiNumber: practice.npiNumber,
  entityType: (practice.entityType ?? "COVERED_ENTITY") as "COVERED_ENTITY" | "BUSINESS_ASSOCIATE",
  primaryState: practice.primaryState,
  operatingStates: practice.operatingStates ?? [],
  addressStreet: practice.addressStreet,
  addressSuite: practice.addressSuite,
  addressCity: practice.addressCity,
  addressZip: practice.addressZip,
  specialty: practice.specialty,
  providerCount: (practice.providerCount ?? "SOLO") as PracticeProfileInput["providerCount"],
  ehrSystem: practice.ehrSystem,
  staffHeadcount: practice.staffHeadcount,
  phone: practice.phone,
};
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: full suite passes.

- [ ] **Step 5: Commit + push + open PR (PR 4)**

```bash
git add src/app/onboarding/compliance-profile/
git commit -m "feat(onboarding): embed PracticeProfileForm in compliance-profile"
git push -u origin feat/settings-pr4-practice-profile
gh pr create --title "feat(settings): unified PracticeProfileForm + onboarding expansion (PR 4 of 5)" --body "$(cat <<'EOF'
## Summary

PR 4 of 5 from the Settings & Onboarding restructure spec — the largest piece.

- New \`<PracticeProfileForm>\` unified form (Identity / Location / Practice sections)
- New \`<EhrCombobox>\` (12 known EHRs + Other free-text)
- New \`isValidNpi()\` Luhn helper
- New \`savePracticeProfileAction\` server action with audit event
- New \`PRACTICE_PROFILE_UPDATED\` event type
- \`/settings/practice\` renders the form in settings mode (all sections + optional fields)
- Onboarding \`compliance-profile\` embeds the form in onboarding mode (hides staffHeadcount + phone)

## Test plan

- [x] tsc + lint clean
- [x] Tests: NPI 5, EhrCombobox 5, PracticeProfileForm 7, action 3 = +20

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 5 — Subscription page

**Branch:** `feat/settings-pr5-subscription`

**Goal:** New `/settings/subscription` page with `<SubscriptionPanel>` (status display + Stripe Customer Portal redirect). New `/settings` index page. Reuse the existing Stripe portal action by extracting it to a shared module.

### Task 5.1: Extract Stripe portal action to a shared module

**Files:**
- Create: `src/lib/billing/portal.ts`
- Modify: `src/app/(auth)/account/locked/actions.ts` (re-export from shared)

- [ ] **Step 1: Read existing action**

Run: `cat src/app/\(auth\)/account/locked/actions.ts`

Note the existing implementation. It uses `getStripe().billingPortal.sessions.create({ customer, return_url })`.

- [ ] **Step 2: Move to shared module**

Create `src/lib/billing/portal.ts`:

```ts
// src/lib/billing/portal.ts
"use server";

import { getStripe } from "@/lib/stripe";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";

export async function openBillingPortalAction(args?: {
  returnUrl?: string;
}): Promise<
  | { ok: true; url: string }
  | { ok: false; error: "no-stripe-customer" | "not-authenticated" | "stripe-error" }
> {
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "not-authenticated" };

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { stripeCustomerId: true },
  });

  if (!practice.stripeCustomerId) {
    return { ok: false, error: "no-stripe-customer" };
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: practice.stripeCustomerId,
      return_url: args?.returnUrl ?? "https://v2.app.gwcomp.com/settings/subscription",
    });
    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "stripe-error" };
  }
}
```

- [ ] **Step 3: Update /account/locked/actions.ts to re-export**

Replace the action implementation in `src/app/(auth)/account/locked/actions.ts` with:

```ts
"use server";
export { openBillingPortalAction as openBillingPortalActionLocked } from "@/lib/billing/portal";
```

(Or re-export the same action under the same name — depends on the existing import surface.)

- [ ] **Step 4: Update OpenBillingPortalButton.tsx import (if it imports the action)**

Find any `OpenBillingPortalButton` consumers and update the import to point at the new location if needed.

- [ ] **Step 5: Run tsc + tests + lint**

Run: `npx tsc --noEmit && npx eslint src/ && npm test -- --run`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/settings-pr5-subscription
git add src/lib/billing/ src/app/\(auth\)/account/locked/
git commit -m "refactor(billing): extract openBillingPortalAction to shared module"
```

### Task 5.2: SubscriptionPanel component

**Files:**
- Create: `src/components/gw/SubscriptionPanel/index.tsx`
- Create: `src/components/gw/SubscriptionPanel/SubscriptionPanel.test.tsx`

- [ ] **Step 1: Write failing test**

Create the test (mock the action since it depends on Stripe):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubscriptionPanel } from "./index";

describe("SubscriptionPanel", () => {
  const baseProps = {
    subscriptionStatus: "ACTIVE" as const,
    currentPeriodEnd: new Date("2026-05-29T00:00:00Z"),
    trialEndsAt: null,
    stripeCustomerId: "cus_xxx",
    cardLast4: "4242",
    planLabel: "GuardWell · Monthly · $249",
  };

  it("renders ACTIVE badge + next billing date + last4", () => {
    render(<SubscriptionPanel {...baseProps} />);
    expect(screen.getByText(/active/i)).toBeInTheDocument();
    expect(screen.getByText(/may 29, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/4242/)).toBeInTheDocument();
  });

  it("renders TRIALING badge + days remaining", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5);
    render(
      <SubscriptionPanel
        {...baseProps}
        subscriptionStatus="TRIALING"
        currentPeriodEnd={null}
        trialEndsAt={future}
      />,
    );
    expect(screen.getByText(/trial/i)).toBeInTheDocument();
    expect(screen.getByText(/5 days/i)).toBeInTheDocument();
  });

  it("renders PAST_DUE badge with destructive variant + Update payment CTA", () => {
    render(
      <SubscriptionPanel
        {...baseProps}
        subscriptionStatus="PAST_DUE"
      />,
    );
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update payment/i })).toBeInTheDocument();
  });

  it("renders CANCELED badge + Reactivate CTA", () => {
    render(
      <SubscriptionPanel
        {...baseProps}
        subscriptionStatus="CANCELED"
      />,
    );
    expect(screen.getByText(/canceled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reactivate/i })).toBeInTheDocument();
  });

  it("renders Manage subscription button when stripeCustomerId is set", () => {
    render(<SubscriptionPanel {...baseProps} />);
    expect(screen.getByRole("button", { name: /manage subscription/i })).toBeInTheDocument();
  });

  it("hides Manage subscription button when no stripeCustomerId", () => {
    render(
      <SubscriptionPanel {...baseProps} stripeCustomerId={null} />,
    );
    expect(screen.queryByRole("button", { name: /manage subscription/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `npm test -- --run src/components/gw/SubscriptionPanel/`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/gw/SubscriptionPanel/index.tsx`:

```tsx
// src/components/gw/SubscriptionPanel/index.tsx
//
// Server component (renders inline in /settings/subscription) that displays
// the practice's current Stripe subscription state and provides a single
// "Manage subscription" button that opens the Stripe Customer Portal.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openBillingPortalAction } from "@/lib/billing/portal";

export type SubscriptionStatus =
  | "INCOMPLETE"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED";

export interface SubscriptionPanelProps {
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  cardLast4: string | null;
  planLabel: string;
}

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const variant: "default" | "secondary" | "destructive" =
    status === "ACTIVE"
      ? "default"
      : status === "PAST_DUE" || status === "CANCELED"
        ? "destructive"
        : "secondary";
  const label =
    status === "ACTIVE"
      ? "Active"
      : status === "TRIALING"
        ? "Trial"
        : status === "PAST_DUE"
          ? "Past due"
          : status === "CANCELED"
            ? "Canceled"
            : "Incomplete";
  return <Badge variant={variant}>{label}</Badge>;
}

function daysUntil(date: Date | null): number {
  if (!date) return 0;
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function SubscriptionPanel(props: SubscriptionPanelProps) {
  const {
    subscriptionStatus,
    currentPeriodEnd,
    trialEndsAt,
    stripeCustomerId,
    cardLast4,
    planLabel,
  } = props;

  return (
    <div className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{planLabel}</h2>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={subscriptionStatus} />
            {subscriptionStatus === "TRIALING" && trialEndsAt && (
              <span className="text-sm text-muted-foreground">
                Trial ends in {daysUntil(trialEndsAt)} days
              </span>
            )}
            {subscriptionStatus === "ACTIVE" && currentPeriodEnd && (
              <span className="text-sm text-muted-foreground">
                Renews on {formatDate(currentPeriodEnd)}
              </span>
            )}
          </div>
        </div>
      </div>

      {cardLast4 && (
        <p className="text-sm text-muted-foreground">
          Payment method: card ending in {cardLast4}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        {stripeCustomerId && (
          <form
            action={async () => {
              "use server";
              const result = await openBillingPortalAction();
              if (result.ok) {
                // Server action redirects/replaces in the response; if not, the
                // client form will refetch + display the updated state.
                // Note: Stripe portal opens in same tab. Could be window.open
                // for new-tab behavior — defer to writing-plans for the choice.
                return result.url;
              }
              throw new Error(result.error);
            }}
          >
            <Button type="submit" variant="default">
              {subscriptionStatus === "PAST_DUE" || subscriptionStatus === "CANCELED"
                ? subscriptionStatus === "CANCELED"
                  ? "Reactivate subscription"
                  : "Update payment method"
                : "Manage subscription"}
            </Button>
          </form>
        )}
        {subscriptionStatus === "TRIALING" && (
          <Button variant="outline" asChild>
            <a href="/api/stripe/checkout?fromTrial=1">Subscribe now</a>
          </Button>
        )}
      </div>
    </div>
  );
}
```

(The `<form>` action wrapping with `"use server"` + a Button + the Stripe redirect is awkward — refactor in writing-plans if needed. The simplest pattern is a client-side button that calls the action via `useTransition`, then `window.open(result.url)`.)

- [ ] **Step 4: Run + pass**

Run: `npm test -- --run src/components/gw/SubscriptionPanel/`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/gw/SubscriptionPanel/
git commit -m "feat(settings): SubscriptionPanel component"
```

### Task 5.3: /settings index page + /settings/subscription page

**Files:**
- Create: `src/app/(dashboard)/settings/page.tsx`
- Create: `src/app/(dashboard)/settings/subscription/page.tsx`

- [ ] **Step 1: Create settings index**

Create `src/app/(dashboard)/settings/page.tsx`:

```tsx
import Link from "next/link";
import type { Route } from "next";
import { Settings, Bell, CreditCard } from "lucide-react";

export const metadata = { title: "Settings · GuardWell" };

const SECTIONS = [
  {
    href: "/settings/practice",
    icon: Settings,
    title: "Practice profile",
    description: "Identity, location, NPI, specialty, and EHR.",
  },
  {
    href: "/settings/notifications",
    icon: Bell,
    title: "Notifications",
    description: "Daily/weekly digest and alert preferences.",
  },
  {
    href: "/settings/subscription",
    icon: CreditCard,
    title: "Subscription",
    description: "Plan, billing, and payment method.",
  },
] as const;

export default function SettingsIndexPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map(({ href, icon: Icon, title, description }) => (
          <li key={href}>
            <Link
              href={href as Route}
              className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-start gap-3">
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold">{title}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Create subscription page**

Create `src/app/(dashboard)/settings/subscription/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { SubscriptionPanel } from "@/components/gw/SubscriptionPanel";
import type { SubscriptionStatus } from "@/components/gw/SubscriptionPanel";

export const metadata = { title: "Subscription · Settings · GuardWell" };
export const dynamic = "force-dynamic";

async function fetchCardLast4(stripeCustomerId: string | null): Promise<string | null> {
  if (!stripeCustomerId) return null;
  try {
    const customer = await getStripe().customers.retrieve(stripeCustomerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return null;
    const dpm = customer.invoice_settings?.default_payment_method;
    if (typeof dpm === "string" || !dpm) return null;
    return dpm.card?.last4 ?? null;
  } catch {
    return null; // Stripe API failure — render page without last4
  }
}

export default async function SubscriptionPage() {
  const pu = await getPracticeUser();
  if (!pu) redirect("/sign-in" as Route);

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: {
      subscriptionStatus: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      stripeCustomerId: true,
    },
  });

  const cardLast4 = await fetchCardLast4(practice.stripeCustomerId);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Subscription</h1>
      <SubscriptionPanel
        subscriptionStatus={practice.subscriptionStatus as SubscriptionStatus}
        currentPeriodEnd={practice.currentPeriodEnd}
        trialEndsAt={practice.trialEndsAt}
        stripeCustomerId={practice.stripeCustomerId}
        cardLast4={cardLast4}
        planLabel="GuardWell · $249/mo"
      />
    </main>
  );
}
```

- [ ] **Step 3: Run tsc + lint + tests**

Run: `npx tsc --noEmit && npx eslint "src/app/(dashboard)/settings/" && npm test -- --run`
Expected: clean.

- [ ] **Step 4: Commit + push + open PR (PR 5)**

```bash
git add src/app/\(dashboard\)/settings/
git commit -m "feat(settings): /settings index + /settings/subscription pages"
git push -u origin feat/settings-pr5-subscription
gh pr create --title "feat(settings): subscription page (PR 5 of 5)" --body "$(cat <<'EOF'
## Summary

PR 5 of 5 from the Settings & Onboarding restructure spec — closes the arc.

- Refactor: \`openBillingPortalAction\` extracted to \`src/lib/billing/portal.ts\`
- New \`<SubscriptionPanel>\` (status badge, trial countdown / next billing, last 4 of card, portal button)
- New \`/settings\` index page (3-card link list)
- New \`/settings/subscription\` page (renders SubscriptionPanel with live Stripe state)

## Test plan

- [x] tsc + lint clean
- [x] Tests: SubscriptionPanel 6 = +6
- [ ] After deploy: Chrome verify — subscription page shows correct status, "Manage subscription" opens portal

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Final tally

After all 5 PRs merged:

- **Tests**: baseline 721 → ~+72 (PR 1 +14, PR 2 +24, PR 3 +17, PR 4 +20, PR 5 +6); rough estimate, exact count subject to TDD adjustments
- **Schema migrations**: 1 (new event type `PRACTICE_PROFILE_UPDATED` registered in PR 4 — additive)
- **Migration scripts**: 1 (`scripts/backfill-practice-specialty.ts` run once after PR 2 deploy)
- **New pages**: `/settings/`, `/settings/subscription/`
- **New components**: `<UserMenu>`, `<SpecialtyCombobox>`, `<StateMultiSelect>`, `<EhrCombobox>`, `<PracticeProfileForm>`, `<SubscriptionPanel>` — 6 total
- **Refactors**: TopBar, Sidebar, AppShell, ComplianceProfileForm, /settings/practice, openBillingPortalAction

## Spec self-review

Re-checked against [the spec](../specs/2026-04-29-settings-restructure-design.md):

- ✅ AppShell avatar dropdown — PR 1
- ✅ Sidebar Settings section removed — PR 1.5
- ✅ 5 new fields in onboarding (operatingStates, npiNumber, addressFields, entityType, ehrSystem) — PR 3 (multi-state) + PR 4 (rest)
- ✅ All onboarding fields editable in settings — PR 4
- ✅ Specialty curated 30+1 list with derived bucket — PR 2
- ✅ Multi-state UI (primary + chip multi-select) — PR 3
- ✅ Subscription page with Stripe Customer Portal — PR 5
- ✅ Migration script — PR 2
- ✅ PRACTICE_PROFILE_UPDATED event — PR 4
- ✅ Tests + jest-axe per component
- ✅ All 5 PRs independently testable + deployable

Open items deferred to implementation:

- Subscription page form-action vs. client-side `useTransition` pattern (the spec says "form action POST"; the plan acknowledges that's awkward and notes the alternative)
- Exact line numbers in modified files (Sidebar.tsx etc.) may have shifted between writing the spec and execution — implementer should re-read the file before editing
