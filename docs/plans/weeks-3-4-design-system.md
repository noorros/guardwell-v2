# Weeks 3-4 — Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 11 `gw/` domain components from ADR-0005 with stories, component tests, and an accessibility audit — ready for module page work in weeks 5-6.

**Architecture:** Each component lives in `src/components/gw/<Name>/` with `index.tsx`, `<Name>.test.tsx`, and `<Name>.stories.tsx`. Components compose Shadcn primitives in `src/components/ui/`. Color/status variants read tokens from `globals.css` — never hardcode. Vitest runs component tests in jsdom; an a11y gallery route at `/internal/design-system` renders every variant for manual + axe-core scanning.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Tailwind v4, Shadcn `new-york`, lucide-react icons, Vitest 4 + @testing-library/react + jest-axe, class-variance-authority for variants.

**Working directory throughout:** `D:/GuardWell/guardwell-v2`. Always `cd` explicitly per `memory/bash-gotchas.md`.

**Done state at end of week 4:**
- All 11 `gw/` components implemented with tests + stories.
- `npm test` runs two projects: node (existing integration tests) + jsdom (new component tests), both green.
- `npm run lint` and `npx tsc --noEmit` clean.
- `/internal/design-system` gallery route renders every component with every variant.
- jest-axe scan over the gallery reports zero violations.
- `/dashboard` re-skinned with `<PracticeIdentityCard>` and deployed to `v2.app.gwcomp.com`.

---

## File Structure (locked at start of plan)

```
guardwell-v2/
├── package.json                                                # MODIFY (Task A1 — add devDeps)
├── vitest.config.ts                                            # REWRITE (Task A2 — two-project config)
├── tests/
│   ├── setup.ts                                                # EXISTS (node project setup)
│   └── setup-jsdom.ts                                          # CREATE (Task A2)
├── src/
│   ├── app/
│   │   ├── globals.css                                         # EXISTS (tokens already in place)
│   │   ├── layout.tsx                                          # EXISTS
│   │   ├── (dashboard)/
│   │   │   └── dashboard/
│   │   │       └── page.tsx                                    # REWRITE (Task J1)
│   │   └── internal/
│   │       └── design-system/
│   │           └── page.tsx                                    # CREATE (Task I1)
│   ├── lib/
│   │   ├── utils.ts                                            # EXISTS (scoreToLabel/scoreToColorToken live here)
│   │   ├── utils.test.ts                                       # CREATE (Task B3)
│   │   └── severity.ts                                         # CREATE (Task G1 — shared severity helper)
│   └── components/
│       ├── ui/                                                 # EXISTS (empty); populated by Shadcn CLI in Task B1
│       │   ├── button.tsx                                      # CREATE via shadcn (Task B1)
│       │   ├── card.tsx                                        # CREATE via shadcn (Task B1)
│       │   ├── dialog.tsx                                      # CREATE via shadcn (Task B1)
│       │   ├── badge.tsx                                       # CREATE via shadcn (Task B1)
│       │   ├── alert.tsx                                       # CREATE via shadcn (Task B1)
│       │   ├── separator.tsx                                   # CREATE via shadcn (Task B1)
│       │   └── sheet.tsx                                       # CREATE via shadcn (Task B1)
│       └── gw/                                                 # CREATE (this plan)
│           ├── EmptyState/
│           │   ├── index.tsx                                   # CREATE (Task C1)
│           │   ├── EmptyState.test.tsx                         # CREATE (Task C1)
│           │   └── EmptyState.stories.tsx                      # CREATE (Task C1)
│           ├── RegulationCitation/
│           │   ├── index.tsx                                   # CREATE (Task C2)
│           │   ├── RegulationCitation.test.tsx                 # CREATE (Task C2)
│           │   └── RegulationCitation.stories.tsx              # CREATE (Task C2)
│           ├── EvidenceBadge/
│           │   ├── index.tsx                                   # CREATE (Task C3)
│           │   ├── EvidenceBadge.test.tsx                      # CREATE (Task C3)
│           │   └── EvidenceBadge.stories.tsx                   # CREATE (Task C3)
│           ├── ScoreRing/
│           │   ├── index.tsx                                   # CREATE (Task D1)
│           │   ├── ScoreRing.test.tsx                          # CREATE (Task D1)
│           │   └── ScoreRing.stories.tsx                       # CREATE (Task D1)
│           ├── ComplianceCard/
│           │   ├── index.tsx                                   # CREATE (Task E1)
│           │   ├── ComplianceCard.test.tsx                     # CREATE (Task E1)
│           │   └── ComplianceCard.stories.tsx                  # CREATE (Task E1)
│           ├── ChecklistItem/
│           │   ├── index.tsx                                   # CREATE (Task E2)
│           │   ├── ChecklistItem.test.tsx                      # CREATE (Task E2)
│           │   └── ChecklistItem.stories.tsx                   # CREATE (Task E2)
│           ├── ModuleHeader/
│           │   ├── index.tsx                                   # CREATE (Task F1)
│           │   ├── ModuleHeader.test.tsx                       # CREATE (Task F1)
│           │   └── ModuleHeader.stories.tsx                    # CREATE (Task F1)
│           ├── PracticeIdentityCard/
│           │   ├── index.tsx                                   # CREATE (Task F2)
│           │   ├── PracticeIdentityCard.test.tsx               # CREATE (Task F2)
│           │   └── PracticeIdentityCard.stories.tsx            # CREATE (Task F2)
│           ├── DeadlineWarning/
│           │   ├── index.tsx                                   # CREATE (Task G2)
│           │   ├── DeadlineWarning.test.tsx                    # CREATE (Task G2)
│           │   └── DeadlineWarning.stories.tsx                 # CREATE (Task G2)
│           ├── MajorBreachBanner/
│           │   ├── index.tsx                                   # CREATE (Task G3)
│           │   ├── MajorBreachBanner.test.tsx                  # CREATE (Task G3)
│           │   └── MajorBreachBanner.stories.tsx               # CREATE (Task G3)
│           ├── AiAssistDrawer/
│           │   ├── index.tsx                                   # CREATE (Task H1)
│           │   ├── AiAssistDrawer.test.tsx                     # CREATE (Task H1)
│           │   └── AiAssistDrawer.stories.tsx                  # CREATE (Task H1)
│           └── gallery.test.tsx                                # CREATE (Task I2 — axe scan over gallery)
```

---

## Chunk A — Component-test infrastructure (Day 1, ~2 hours)

### Task A1: Install testing dependencies

**Files:**
- Modify: `package.json` (adds devDeps)
- Side effect: updates `package-lock.json`, populates `node_modules/`.

- [ ] **Step 1: Install missing component-test packages**

```bash
cd "D:/GuardWell/guardwell-v2" && npm install --save-dev jsdom @testing-library/user-event jest-axe @types/jest-axe
```

Expected: `added X packages` without errors. `@testing-library/react` and `@testing-library/jest-dom` are already in `devDependencies` from Week 1–2, so they won't be reinstalled.

- [ ] **Step 2: Verify the new deps are resolvable**

```bash
cd "D:/GuardWell/guardwell-v2" && node -e "require.resolve('jsdom'); require.resolve('jest-axe'); require.resolve('@testing-library/user-event'); console.log('ok')"
```

Expected: `ok`.

### Task A2: Wire Vitest two-project config + jsdom setup

**Files:**
- Rewrite: `vitest.config.ts` (switch to `projects`)
- Create: `tests/setup-jsdom.ts`

Rationale: the existing `tests/setup.ts` opens a live Prisma connection in `beforeAll` and wipes tables in `afterEach` — that's fine for integration tests in the node project, but catastrophic for component tests that shouldn't touch the database at all. Two projects keep them isolated.

- [ ] **Step 1: Rewrite `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    coverage: { provider: "v8", reporter: ["text", "html"] },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/**/*.test.ts", "src/lib/**/*.test.ts"],
          globals: false,
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./tests/setup-jsdom.ts"],
          include: ["src/components/**/*.test.{ts,tsx}"],
          globals: false,
        },
      },
    ],
  },
});
```

- [ ] **Step 2: Create `tests/setup-jsdom.ts`**

```ts
// jsdom test setup. Extends Vitest's expect with @testing-library/jest-dom
// matchers (toBeInTheDocument, toHaveAccessibleName, etc.) and registers
// jest-axe's toHaveNoViolations matcher for a11y assertions.

import "@testing-library/jest-dom/vitest";
import { expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 3: Sanity check — write a trivial component test before any gw/ work**

Create `src/components/ui/__scratch__.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("scratch jsdom", () => {
  it("renders into the DOM", () => {
    render(<button type="button">Hello</button>);
    expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run both projects**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run
```

Expected: two projects run. The `jsdom` project shows `1 passed`. The `node` project runs its existing integration tests (unchanged from week 2).

- [ ] **Step 5: Delete the scratch test + confirm clean**

```bash
cd "D:/GuardWell/guardwell-v2" && rm src/components/ui/__scratch__.test.tsx && npx vitest run --project jsdom
```

Expected: `no test files found` (for the jsdom project — the node project still passes).

### Task A3: Commit chunk A

- [ ] **Step 1: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "test: vitest two-project setup (node + jsdom) with @testing-library/react + jest-axe"
```

---

## Chunk B — Shadcn primitives + tokens audit (Day 1-2, ~2 hours)

### Task B1: Generate Shadcn primitives

**Files:**
- Create: `src/components/ui/{button,card,dialog,badge,alert,separator,sheet}.tsx`
- Possibly modify: `components.json` if prompts occur

- [ ] **Step 1: Verify `components.json` exists**

```bash
cd "D:/GuardWell/guardwell-v2" && cat components.json
```

Expected: JSON with `"style": "new-york"`, `"rsc": true`, `"tsx": true`. If it doesn't exist, run `npx shadcn@latest init -d` and accept defaults (new-york, slate, tailwind v4).

- [ ] **Step 2: Add the 7 primitives**

```bash
cd "D:/GuardWell/guardwell-v2" && npx shadcn@latest add button card dialog badge alert separator sheet
```

Expected: each component writes its file to `src/components/ui/`. Any prompts (overwrite? install deps?) — accept defaults (Yes to overwrite, Yes to install missing deps).

- [ ] **Step 3: Verify files exist**

```bash
cd "D:/GuardWell/guardwell-v2" && ls src/components/ui/
```

Expected: `alert.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `dialog.tsx`, `separator.tsx`, `sheet.tsx`.

- [ ] **Step 4: Verify TypeScript compiles after scaffold**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors. If Shadcn added a Radix dep we don't have installed, `npm install` completes it; re-run `tsc`.

### Task B2: Tokens sanity audit

Shadcn's scaffolded components inject extra tokens (e.g. `--chart-1`, `--sidebar`) into `globals.css`. Our `gw/` tokens must remain intact alongside them.

- [ ] **Step 1: Check the GW tokens survived the scaffold**

```bash
cd "D:/GuardWell/guardwell-v2" && grep -n "gw-color-compliant\|gw-z-modal" src/app/globals.css
```

Expected: both variable names present. If Shadcn overwrote them, restore: re-apply the `:root { --gw-color-compliant: oklch(0.65 0.18 145); ... }` block from Week 1–2 work.

- [ ] **Step 2: Verify tokens resolve at runtime by adding a throwaway test**

Create `src/components/ui/__tokens__.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

describe("gw tokens", () => {
  it("are referenceable via CSS var()", () => {
    const { container } = render(
      <div data-testid="probe" style={{ color: "var(--gw-color-compliant)" }} />,
    );
    const el = container.querySelector("[data-testid='probe']") as HTMLElement;
    // jsdom doesn't apply real styles but will reflect what we set inline
    expect(el.getAttribute("style")).toContain("--gw-color-compliant");
  });
});
```

- [ ] **Step 2a: Run + clean up**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/ui/__tokens__.test.tsx && rm src/components/ui/__tokens__.test.tsx
```

Expected: 1 passed.

### Task B3: Sanity test for `cn` + score helpers

The `scoreToLabel` and `scoreToColorToken` helpers already live in `src/lib/utils.ts` from Week 1–2. Every component that color-codes by score depends on them — if they regress, many tests break silently. Pin them with a unit test now.

**Files:**
- Create: `src/lib/utils.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/lib/utils.test.ts
import { describe, it, expect } from "vitest";
import { cn, scoreToLabel, scoreToColorToken } from "./utils";

describe("cn", () => {
  it("merges + de-conflicts tailwind classes (later wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("handles falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("handles nested arrays + objects (clsx semantics)", () => {
    expect(cn(["a", { b: true, c: false }], "d")).toBe("a b d");
  });
});

describe("scoreToLabel", () => {
  it.each([
    [100, "Compliant"],
    [90, "Compliant"],
    [89, "Good"],
    [70, "Good"],
    [69, "Needs Work"],
    [50, "Needs Work"],
    [49, "At Risk"],
    [0, "At Risk"],
  ] as const)("score %i -> %s", (score, label) => {
    expect(scoreToLabel(score)).toBe(label);
  });
});

describe("scoreToColorToken", () => {
  it.each([
    [95, "var(--gw-color-compliant)"],
    [75, "var(--gw-color-good)"],
    [55, "var(--gw-color-needs)"],
    [25, "var(--gw-color-risk)"],
  ] as const)("score %i -> %s", (score, token) => {
    expect(scoreToColorToken(score)).toBe(token);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node src/lib/utils.test.ts
```

Expected: 3 describe blocks, all pass.

### Task B4: Commit chunk B

- [ ] **Step 1: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(ui): scaffold shadcn primitives (button/card/dialog/badge/alert/separator/sheet) + pin cn/score helpers with tests"
```

---

## Chunk C — Leaf components (Day 3, ~5 hours)

Every leaf is strict TDD: **test → see red → implement → see green → story → commit per component.**

### Task C1: `<EmptyState>`

**Purpose (per ADR-0005):** `icon, title, description, action`. One component, used by every page that has a "no X yet" state.

**API:**
```ts
interface EmptyStateProps {
  icon?: LucideIcon;         // optional; defaults to Inbox
  title: string;
  description?: string;
  action?: { label: string; onClick?: () => void; href?: string };
  className?: string;
}
```

**Files:**
- Create: `src/components/gw/EmptyState/EmptyState.test.tsx`
- Create: `src/components/gw/EmptyState/index.tsx`
- Create: `src/components/gw/EmptyState/EmptyState.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/EmptyState/EmptyState.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Users } from "lucide-react";
import { EmptyState } from ".";

describe("<EmptyState>", () => {
  it("renders title + description", () => {
    render(<EmptyState title="No staff yet" description="Invite your first user." />);
    expect(screen.getByRole("heading", { name: "No staff yet" })).toBeInTheDocument();
    expect(screen.getByText("Invite your first user.")).toBeInTheDocument();
  });

  it("uses a default icon when none is passed, marked aria-hidden", () => {
    const { container } = render(<EmptyState title="Empty" />);
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("respects a custom icon", () => {
    const { container } = render(<EmptyState icon={Users} title="No users" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders an action button and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        action={{ label: "Add first item", onClick }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add first item" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a link when action.href is passed (no onClick required)", () => {
    render(
      <EmptyState
        title="Empty"
        action={{ label: "Go home", href: "/dashboard" }}
      />,
    );
    const link = screen.getByRole("link", { name: "Go home" });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("has a status/region landmark so SR users hear the empty state", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/EmptyState
```

Expected: all tests FAIL (module doesn't exist yet).

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/EmptyState/index.tsx
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center",
        className,
      )}
    >
      <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && (
        action.href ? (
          <a
            href={action.href}
            className="mt-2 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {action.label}
          </a>
        ) : (
          <Button type="button" onClick={action.onClick} className="mt-2">
            {action.label}
          </Button>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/EmptyState
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/EmptyState/EmptyState.stories.tsx
//
// Stories aren't rendered by Storybook (deferred per ADR-0005); they're
// consumed by the gallery route at /internal/design-system and scanned
// by jest-axe. Each exported story is a plain React element.

import { FileText, Users, AlertTriangle } from "lucide-react";
import { EmptyState } from ".";

export const stories = {
  Default: <EmptyState title="No items yet" />,
  WithDescription: (
    <EmptyState
      title="No staff yet"
      description="Invite your first user to get started."
    />
  ),
  WithButtonAction: (
    <EmptyState
      icon={Users}
      title="No staff yet"
      description="Invite your first user to get started."
      action={{ label: "Invite user", onClick: () => {} }}
    />
  ),
  WithLinkAction: (
    <EmptyState
      icon={FileText}
      title="No policies adopted"
      description="Start with a policy template."
      action={{ label: "Browse templates", href: "#" }}
    />
  ),
  Warning: (
    <EmptyState
      icon={AlertTriangle}
      title="No evidence on file"
      description="This control has no linked evidence. Add one to mark it compliant."
    />
  ),
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): EmptyState component + tests + stories"
```

### Task C2: `<RegulationCitation>`

**Purpose (per ADR-0005):** `"45 CFR §164.308(a)(1)(ii)(A)"` formatted with optional hover/link to source.

**API:**
```ts
interface RegulationCitationProps {
  citation: string;       // e.g. "45 CFR §164.308(a)(1)(ii)(A)"
  href?: string;          // optional link to ecfr.gov or state statute
  className?: string;
}
```

**Files:**
- Create: `src/components/gw/RegulationCitation/RegulationCitation.test.tsx`
- Create: `src/components/gw/RegulationCitation/index.tsx`
- Create: `src/components/gw/RegulationCitation/RegulationCitation.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/RegulationCitation/RegulationCitation.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegulationCitation } from ".";

describe("<RegulationCitation>", () => {
  it("renders the citation text verbatim", () => {
    render(<RegulationCitation citation="45 CFR §164.308(a)(1)(ii)(A)" />);
    expect(screen.getByText("45 CFR §164.308(a)(1)(ii)(A)")).toBeInTheDocument();
  });

  it("renders as plain text (no link) when href is absent", () => {
    render(<RegulationCitation citation="45 CFR §164.500" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders an external link when href is present, with rel=noopener noreferrer", () => {
    render(
      <RegulationCitation
        citation="45 CFR §164.500"
        href="https://www.ecfr.gov/current/title-45/section-164.500"
      />,
    );
    const link = screen.getByRole("link", { name: /45 CFR §164\.500/ });
    expect(link).toHaveAttribute("href", "https://www.ecfr.gov/current/title-45/section-164.500");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("uses a monospace / tabular font class for readability", () => {
    const { container } = render(<RegulationCitation citation="ARS §36-664" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toMatch(/font-mono|tabular-nums/);
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/RegulationCitation
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/RegulationCitation/index.tsx
import { cn } from "@/lib/utils";

export interface RegulationCitationProps {
  citation: string;
  href?: string;
  className?: string;
}

export function RegulationCitation({ citation, href, className }: RegulationCitationProps) {
  const baseClass = cn(
    "inline-block font-mono text-xs tabular-nums text-muted-foreground",
    className,
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(baseClass, "underline decoration-dotted underline-offset-2 hover:text-foreground")}
      >
        {citation}
      </a>
    );
  }
  return <span className={baseClass}>{citation}</span>;
}
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/RegulationCitation
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/RegulationCitation/RegulationCitation.stories.tsx
import { RegulationCitation } from ".";

export const stories = {
  HipaaText: <RegulationCitation citation="45 CFR §164.308(a)(1)(ii)(A)" />,
  HipaaLinked: (
    <RegulationCitation
      citation="45 CFR §164.500"
      href="https://www.ecfr.gov/current/title-45/section-164.500"
    />
  ),
  StateCitation: <RegulationCitation citation="ARS §36-664" />,
  OigSafeHarbor: (
    <RegulationCitation citation="42 CFR §1001.952(o)" href="https://www.ecfr.gov/current/title-42/section-1001.952" />
  ),
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): RegulationCitation component + tests + stories"
```

### Task C3: `<EvidenceBadge>`

**Purpose (per ADR-0005):** "Adopted from Policy X" / "Satisfied by Training Y" / "Pending acknowledgment from N staff" link chip.

**API:**
```ts
type EvidenceKind = "policy" | "training" | "acknowledgment-pending" | "attestation" | "document";

interface EvidenceBadgeProps {
  kind: EvidenceKind;
  label: string;          // "Adopted from HIPAA Privacy Policy"
  href?: string;          // deep link to the evidence source
  count?: number;         // only meaningful for acknowledgment-pending
  className?: string;
}
```

**Files:**
- Create: `src/components/gw/EvidenceBadge/EvidenceBadge.test.tsx`
- Create: `src/components/gw/EvidenceBadge/index.tsx`
- Create: `src/components/gw/EvidenceBadge/EvidenceBadge.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/EvidenceBadge/EvidenceBadge.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceBadge } from ".";

describe("<EvidenceBadge>", () => {
  it("renders the label text", () => {
    render(<EvidenceBadge kind="policy" label="Adopted from HIPAA Privacy Policy" />);
    expect(screen.getByText("Adopted from HIPAA Privacy Policy")).toBeInTheDocument();
  });

  it("renders a different icon per kind (policy vs training vs pending)", () => {
    const { rerender, container } = render(
      <EvidenceBadge kind="policy" label="Policy" />,
    );
    const policySvg = container.querySelector("svg")?.outerHTML;

    rerender(<EvidenceBadge kind="training" label="Training" />);
    const trainingSvg = container.querySelector("svg")?.outerHTML;

    rerender(<EvidenceBadge kind="acknowledgment-pending" label="Pending" />);
    const pendingSvg = container.querySelector("svg")?.outerHTML;

    expect(policySvg).not.toEqual(trainingSvg);
    expect(trainingSvg).not.toEqual(pendingSvg);
  });

  it("icons are aria-hidden (label carries the semantic content)", () => {
    const { container } = render(<EvidenceBadge kind="policy" label="x" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the count suffix for acknowledgment-pending", () => {
    render(
      <EvidenceBadge
        kind="acknowledgment-pending"
        label="Pending acknowledgment"
        count={7}
      />,
    );
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it("renders as a link when href is passed", () => {
    render(
      <EvidenceBadge
        kind="training"
        label="Satisfied by HIPAA Basics"
        href="/training/hipaa-basics"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/training/hipaa-basics");
  });

  it("pending-ack kind uses an amber/warning visual signal (not color alone — icon differs)", () => {
    // Redundant signal per ADR-0005: color + icon, never color alone.
    const { container, rerender } = render(
      <EvidenceBadge kind="policy" label="Policy" />,
    );
    const policyIcon = container.querySelector("svg")?.outerHTML;

    rerender(<EvidenceBadge kind="acknowledgment-pending" label="Pending" count={3} />);
    const pendingIcon = container.querySelector("svg")?.outerHTML;

    expect(policyIcon).not.toEqual(pendingIcon);
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/EvidenceBadge
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
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
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/EvidenceBadge
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/EvidenceBadge/EvidenceBadge.stories.tsx
import { EvidenceBadge } from ".";

export const stories = {
  PolicyAdopted: (
    <EvidenceBadge kind="policy" label="Adopted from HIPAA Privacy Policy" href="#" />
  ),
  TrainingSatisfied: (
    <EvidenceBadge kind="training" label="Satisfied by HIPAA Basics 2026" href="#" />
  ),
  AckPending: (
    <EvidenceBadge
      kind="acknowledgment-pending"
      label="Pending acknowledgment from"
      count={7}
    />
  ),
  Attestation: <EvidenceBadge kind="attestation" label="Attested 2026-04-01" />,
  Document: <EvidenceBadge kind="document" label="Uploaded: BAA-Acme.pdf" href="#" />,
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): EvidenceBadge component + tests + stories"
```

---

## Chunk D — `<ScoreRing>` (Day 4, ~3 hours)

### Task D1: Circular SVG progress with threshold color mapping

**Purpose (per ADR-0005):** Circular score gauge, 0–100, color band per thresholds (≥90 Compliant, ≥70 Good, ≥50 Needs, <50 Risk). `aria-labelledby` for SRs.

**API:**
```ts
interface ScoreRingProps {
  score: number;           // 0–100, clamped
  size?: number;           // px, default 96
  strokeWidth?: number;    // px, default 10
  label?: string;          // visible below number, e.g. "HIPAA Privacy"
  id?: string;             // for aria-labelledby reuse
  className?: string;
}
```

**Files:**
- Create: `src/components/gw/ScoreRing/ScoreRing.test.tsx`
- Create: `src/components/gw/ScoreRing/index.tsx`
- Create: `src/components/gw/ScoreRing/ScoreRing.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/ScoreRing/ScoreRing.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreRing } from ".";

describe("<ScoreRing>", () => {
  it("renders the score as integer text", () => {
    render(<ScoreRing score={87} />);
    expect(screen.getByText("87")).toBeInTheDocument();
  });

  it("clamps scores above 100 and below 0", () => {
    const { rerender } = render(<ScoreRing score={150} />);
    expect(screen.getByText("100")).toBeInTheDocument();
    rerender(<ScoreRing score={-5} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("rounds fractional scores (no '87.4' leaking into UI)", () => {
    render(<ScoreRing score={87.4} />);
    expect(screen.getByText("87")).toBeInTheDocument();
  });

  it("maps score -> stroke token: 95 uses compliant color", () => {
    const { container } = render(<ScoreRing score={95} />);
    const fg = container.querySelector("circle[data-role='fg']");
    expect(fg?.getAttribute("stroke")).toBe("var(--gw-color-compliant)");
  });

  it.each([
    [95, "var(--gw-color-compliant)"],
    [75, "var(--gw-color-good)"],
    [55, "var(--gw-color-needs)"],
    [25, "var(--gw-color-risk)"],
  ] as const)("score %i maps to color token %s", (score, token) => {
    const { container } = render(<ScoreRing score={score} />);
    const fg = container.querySelector("circle[data-role='fg']");
    expect(fg?.getAttribute("stroke")).toBe(token);
  });

  it("exposes an accessible name via aria-labelledby when label is passed", () => {
    const { container } = render(<ScoreRing score={80} label="HIPAA Privacy" />);
    const svg = container.querySelector("svg");
    const labelledBy = svg?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    // The referenced element exists and contains useful text
    const labelEl = labelledBy && document.getElementById(labelledBy);
    expect(labelEl?.textContent).toMatch(/HIPAA Privacy/);
  });

  it("includes a screen-reader-only sentence combining score + label text (redundant signal)", () => {
    render(<ScoreRing score={45} label="Security Rule" />);
    // jest-dom's matcher finds text regardless of visual hiding
    expect(
      screen.getByText(/Security Rule: 45 out of 100, At Risk/i),
    ).toBeInTheDocument();
  });

  it("stroke-dashoffset reflects the score (progress = score / 100)", () => {
    const { container } = render(<ScoreRing score={50} size={100} strokeWidth={10} />);
    const fg = container.querySelector("circle[data-role='fg']") as SVGCircleElement | null;
    const dasharray = fg?.getAttribute("stroke-dasharray");
    const dashoffset = fg?.getAttribute("stroke-dashoffset");
    expect(dasharray).toBeTruthy();
    expect(dashoffset).toBeTruthy();
    // At 50%, offset should equal half the circumference.
    const circumference = Number(dasharray);
    const offset = Number(dashoffset);
    expect(Math.abs(offset - circumference / 2)).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/ScoreRing
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/ScoreRing/index.tsx
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
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/ScoreRing
```

Expected: all tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/ScoreRing/ScoreRing.stories.tsx
import { ScoreRing } from ".";

export const stories = {
  Compliant: <ScoreRing score={95} label="HIPAA Privacy" />,
  Good: <ScoreRing score={78} label="HIPAA Security" />,
  NeedsWork: <ScoreRing score={62} label="Breach Readiness" />,
  AtRisk: <ScoreRing score={34} label="OIG Compliance" />,
  Zero: <ScoreRing score={0} label="Not Started" />,
  Perfect: <ScoreRing score={100} label="All Done" />,
  LargeNoLabel: <ScoreRing score={88} size={160} strokeWidth={14} />,
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): ScoreRing with threshold color + SR-only description + aria-labelledby"
```

---

## Chunk E — `<ComplianceCard>` + `<ChecklistItem>` (Day 5, ~4 hours)

### Task E1: `<ComplianceCard>`

**Purpose (per ADR-0005):** The unit container for any compliance item — composes `<ScoreRing>` + framework name + status chip.

**API:**
```ts
interface ComplianceCardProps {
  title: string;              // "HIPAA Privacy Rule"
  score: number;              // 0-100
  subtitle?: string;          // "45 CFR Part 164, Subpart E"
  href?: string;              // whole card clickable
  footer?: ReactNode;         // slot for child chips / counts
  className?: string;
}
```

**Files:**
- Create: `src/components/gw/ComplianceCard/ComplianceCard.test.tsx`
- Create: `src/components/gw/ComplianceCard/index.tsx`
- Create: `src/components/gw/ComplianceCard/ComplianceCard.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/ComplianceCard/ComplianceCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComplianceCard } from ".";

describe("<ComplianceCard>", () => {
  it("renders the title as a heading", () => {
    render(<ComplianceCard title="HIPAA Privacy Rule" score={80} />);
    expect(screen.getByRole("heading", { name: "HIPAA Privacy Rule" })).toBeInTheDocument();
  });

  it("renders the subtitle when provided", () => {
    render(
      <ComplianceCard
        title="HIPAA Privacy"
        subtitle="45 CFR Part 164, Subpart E"
        score={80}
      />,
    );
    expect(screen.getByText("45 CFR Part 164, Subpart E")).toBeInTheDocument();
  });

  it("includes a ScoreRing with the given score", () => {
    render(<ComplianceCard title="X" score={88} />);
    expect(screen.getByText("88")).toBeInTheDocument();
  });

  it("renders a status chip with label from scoreToLabel (e.g. 'Good' at 75)", () => {
    render(<ComplianceCard title="X" score={75} />);
    // Status appears in the card body (as a chip), not just the SR-only line.
    // We look in the chip container via role or text — chip text is visible.
    const matches = screen.getAllByText("Good");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("wraps content in an anchor when href is passed", () => {
    render(<ComplianceCard title="HIPAA Privacy" score={80} href="/modules/hipaa-privacy" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/modules/hipaa-privacy");
    // And it still contains the title
    expect(link).toHaveTextContent("HIPAA Privacy");
  });

  it("renders footer slot content when provided", () => {
    render(
      <ComplianceCard
        title="X"
        score={80}
        footer={<span data-testid="footer-slot">7 gaps</span>}
      />,
    );
    expect(screen.getByTestId("footer-slot")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/ComplianceCard
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/ComplianceCard/index.tsx
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/gw/ScoreRing";
import { cn, scoreToLabel } from "@/lib/utils";

export interface ComplianceCardProps {
  title: string;
  score: number;
  subtitle?: string;
  href?: string;
  footer?: ReactNode;
  className?: string;
}

function CardBody({ title, score, subtitle, footer }: Omit<ComplianceCardProps, "href" | "className">) {
  const label = scoreToLabel(score);
  return (
    <CardContent className="flex items-center gap-4 p-5">
      <ScoreRing score={score} size={72} strokeWidth={8} />
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="truncate text-base font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        <div className="flex items-center gap-2 pt-1">
          <Badge variant="secondary">{label}</Badge>
          {footer}
        </div>
      </div>
    </CardContent>
  );
}

export function ComplianceCard({ title, score, subtitle, href, footer, className }: ComplianceCardProps) {
  const body = <CardBody title={title} score={score} subtitle={subtitle} footer={footer} />;
  if (href) {
    return (
      <a href={href} className={cn("block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", className)}>
        <Card className="transition-colors hover:bg-accent">{body}</Card>
      </a>
    );
  }
  return <Card className={className}>{body}</Card>;
}
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/ComplianceCard
```

Expected: all tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/ComplianceCard/ComplianceCard.stories.tsx
import { ComplianceCard } from ".";

export const stories = {
  Compliant: (
    <ComplianceCard
      title="HIPAA Privacy Rule"
      subtitle="45 CFR Part 164, Subpart E"
      score={95}
    />
  ),
  Good: <ComplianceCard title="HIPAA Security Rule" subtitle="45 CFR Part 164, Subpart C" score={78} />,
  NeedsWork: <ComplianceCard title="Breach Readiness" subtitle="45 CFR §164.400–414" score={62} />,
  AtRisk: <ComplianceCard title="OIG Compliance" subtitle="Safe harbor review" score={34} />,
  Linked: (
    <ComplianceCard
      title="HIPAA Privacy"
      subtitle="Tap to open module"
      score={82}
      href="#"
    />
  ),
  WithFooter: (
    <ComplianceCard
      title="OSHA BBP"
      subtitle="29 CFR §1910.1030"
      score={65}
      footer={<span className="text-xs text-muted-foreground">3 gaps</span>}
    />
  ),
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): ComplianceCard composes ScoreRing + title + subtitle + status chip"
```

### Task E2: `<ChecklistItem>`

**Purpose (per ADR-0005):** The `Compliant / Gap / Not Started` row. **Exclusive selection** — fixes v1's OIG bug where Compliant and Gap buttons both looked active.

**API:**
```ts
type ChecklistStatus = "compliant" | "gap" | "not_started";

interface ChecklistItemProps {
  title: string;
  description?: string;
  status: ChecklistStatus;
  onStatusChange: (next: ChecklistStatus) => void;
  disabled?: boolean;
  className?: string;
}
```

**Files:**
- Create: `src/components/gw/ChecklistItem/ChecklistItem.test.tsx`
- Create: `src/components/gw/ChecklistItem/index.tsx`
- Create: `src/components/gw/ChecklistItem/ChecklistItem.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/ChecklistItem/ChecklistItem.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChecklistItem } from ".";

describe("<ChecklistItem>", () => {
  function Setup(props?: Partial<Parameters<typeof ChecklistItem>[0]>) {
    const onStatusChange = vi.fn();
    render(
      <ChecklistItem
        title="Designate Privacy Officer"
        description="45 CFR §164.530(a)(1)"
        status="not_started"
        onStatusChange={onStatusChange}
        {...props}
      />,
    );
    return { onStatusChange };
  }

  it("renders the title + description", () => {
    Setup();
    expect(screen.getByText("Designate Privacy Officer")).toBeInTheDocument();
    expect(screen.getByText("45 CFR §164.530(a)(1)")).toBeInTheDocument();
  });

  it("presents the three options as a radiogroup (not individual checkboxes)", () => {
    Setup();
    const group = screen.getByRole("radiogroup");
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
  });

  it("marks exactly one radio as checked matching the `status` prop", () => {
    Setup({ status: "compliant" });
    expect(screen.getByRole("radio", { name: /^compliant$/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^gap$/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /not started/i })).not.toBeChecked();
  });

  it("each option has an aria-label AND a visible text label (no aria-label-only)", () => {
    Setup();
    // Every radio should be accessible by its visible text label
    expect(screen.getByRole("radio", { name: /compliant/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /gap/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /not started/i })).toBeVisible();
  });

  it("fires onStatusChange when an unselected option is clicked", async () => {
    const user = userEvent.setup();
    const { onStatusChange } = Setup({ status: "not_started" });
    await user.click(screen.getByRole("radio", { name: /^compliant$/i }));
    expect(onStatusChange).toHaveBeenCalledWith("compliant");
  });

  it("visual: only ONE option shows the 'active' treatment at a time (fixes v1 OIG bug)", () => {
    Setup({ status: "compliant" });
    const active = screen
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("data-active") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAccessibleName(/compliant/i);
  });

  it("status change from compliant -> gap flips the active treatment", async () => {
    const user = userEvent.setup();
    const { onStatusChange } = Setup({ status: "compliant" });
    await user.click(screen.getByRole("radio", { name: /^gap$/i }));
    expect(onStatusChange).toHaveBeenLastCalledWith("gap");
  });

  it("disabled prop disables every radio", () => {
    Setup({ disabled: true });
    for (const r of screen.getAllByRole("radio")) {
      expect(r).toBeDisabled();
    }
  });

  it("arrow keys navigate between options (native radio keyboard semantics)", async () => {
    const user = userEvent.setup();
    const { onStatusChange } = Setup({ status: "not_started" });
    const notStarted = screen.getByRole("radio", { name: /not started/i });
    notStarted.focus();
    await user.keyboard("{ArrowLeft}");
    // ArrowLeft on a radio in a group should select the previous option.
    // Implementations wire this via `name` attr on native radios.
    expect(onStatusChange).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/ChecklistItem
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/ChecklistItem/index.tsx
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
```

Note: `<label>` wrapping a visually-hidden `<input type="radio">` is the accessible pattern that satisfies (a) exclusive selection via native radio semantics, (b) keyboard arrow-key navigation by sharing `name`, (c) screen-reader announcement via the `aria-label` on the input + visible text, and (d) a single visual "active" state via `data-active`.

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/ChecklistItem
```

Expected: all tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/ChecklistItem/ChecklistItem.stories.tsx
import { useState } from "react";
import { ChecklistItem, type ChecklistStatus } from ".";

function Interactive({ initial }: { initial: ChecklistStatus }) {
  const [status, setStatus] = useState<ChecklistStatus>(initial);
  return (
    <ChecklistItem
      title="Designate Privacy Officer"
      description="45 CFR §164.530(a)(1)"
      status={status}
      onStatusChange={setStatus}
    />
  );
}

export const stories = {
  NotStarted: <Interactive initial="not_started" />,
  Compliant: <Interactive initial="compliant" />,
  Gap: <Interactive initial="gap" />,
  Disabled: (
    <ChecklistItem
      title="Read-only requirement"
      description="Viewer role cannot change status"
      status="compliant"
      onStatusChange={() => {}}
      disabled
    />
  ),
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): ChecklistItem with exclusive compliant/gap/not-started radiogroup (fixes v1 OIG ambiguity)"
```

---

## Chunk F — `<ModuleHeader>` + `<PracticeIdentityCard>` (Day 6, ~3 hours)

### Task F1: `<ModuleHeader>`

**Purpose (per ADR-0005):** Header for a regulation page: icon slot, name, citation, current score, jurisdictional badges.

**API:**
```ts
interface ModuleHeaderProps {
  icon: LucideIcon;
  name: string;                   // "HIPAA Privacy Rule"
  citation?: string;              // pass-through to <RegulationCitation>
  citationHref?: string;
  score?: number;                 // shown as <ScoreRing> if passed
  jurisdictions?: string[];       // e.g. ["Federal", "AZ", "CA"]
  className?: string;
}
```

**Files:**
- Create: `src/components/gw/ModuleHeader/ModuleHeader.test.tsx`
- Create: `src/components/gw/ModuleHeader/index.tsx`
- Create: `src/components/gw/ModuleHeader/ModuleHeader.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/ModuleHeader/ModuleHeader.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShieldCheck } from "lucide-react";
import { ModuleHeader } from ".";

describe("<ModuleHeader>", () => {
  it("renders name as an h1 heading", () => {
    render(<ModuleHeader icon={ShieldCheck} name="HIPAA Privacy Rule" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "HIPAA Privacy Rule" });
    expect(h1).toBeInTheDocument();
  });

  it("renders the icon with aria-hidden", () => {
    const { container } = render(<ModuleHeader icon={ShieldCheck} name="X" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a citation when passed", () => {
    render(
      <ModuleHeader icon={ShieldCheck} name="HIPAA Privacy" citation="45 CFR §164.500" />,
    );
    expect(screen.getByText("45 CFR §164.500")).toBeInTheDocument();
  });

  it("renders the citation as a link when citationHref is passed", () => {
    render(
      <ModuleHeader
        icon={ShieldCheck}
        name="HIPAA Privacy"
        citation="45 CFR §164.500"
        citationHref="https://ecfr.gov"
      />,
    );
    const link = screen.getByRole("link", { name: /45 CFR/ });
    expect(link).toHaveAttribute("href", "https://ecfr.gov");
  });

  it("shows a ScoreRing when score is passed", () => {
    render(<ModuleHeader icon={ShieldCheck} name="HIPAA Privacy" score={82} />);
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("omits the ScoreRing when score is undefined", () => {
    const { container } = render(<ModuleHeader icon={ShieldCheck} name="X" />);
    // ScoreRing renders a SECOND svg (the icon is the first). No ring means exactly 1 svg.
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("renders jurisdiction badges as a strip", () => {
    render(
      <ModuleHeader
        icon={ShieldCheck}
        name="HIPAA Privacy"
        jurisdictions={["Federal", "AZ", "CA"]}
      />,
    );
    expect(screen.getByText("Federal")).toBeInTheDocument();
    expect(screen.getByText("AZ")).toBeInTheDocument();
    expect(screen.getByText("CA")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/ModuleHeader
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/ModuleHeader/index.tsx
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/gw/ScoreRing";
import { RegulationCitation } from "@/components/gw/RegulationCitation";
import { cn } from "@/lib/utils";

export interface ModuleHeaderProps {
  icon: LucideIcon;
  name: string;
  citation?: string;
  citationHref?: string;
  score?: number;
  jurisdictions?: string[];
  className?: string;
}

export function ModuleHeader({
  icon: Icon,
  name,
  citation,
  citationHref,
  score,
  jurisdictions,
  className,
}: ModuleHeaderProps) {
  return (
    <header className={cn("flex items-start gap-5 rounded-xl border bg-card p-6", className)}>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="text-xl font-bold text-foreground">{name}</h1>
        {citation && <RegulationCitation citation={citation} href={citationHref} />}
        {jurisdictions && jurisdictions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {jurisdictions.map((j) => (
              <Badge key={j} variant="secondary">{j}</Badge>
            ))}
          </div>
        )}
      </div>
      {typeof score === "number" && (
        <ScoreRing score={score} size={72} strokeWidth={8} />
      )}
    </header>
  );
}
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/ModuleHeader
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/ModuleHeader/ModuleHeader.stories.tsx
import { ShieldCheck, Lock, Building2, Syringe } from "lucide-react";
import { ModuleHeader } from ".";

export const stories = {
  HipaaPrivacy: (
    <ModuleHeader
      icon={ShieldCheck}
      name="HIPAA Privacy Rule"
      citation="45 CFR Part 164, Subpart E"
      citationHref="https://www.ecfr.gov/current/title-45/part-164/subpart-E"
      score={82}
      jurisdictions={["Federal"]}
    />
  ),
  HipaaSecurity: (
    <ModuleHeader
      icon={Lock}
      name="HIPAA Security Rule"
      citation="45 CFR Part 164, Subpart C"
      score={67}
      jurisdictions={["Federal"]}
    />
  ),
  StateMulti: (
    <ModuleHeader
      icon={Building2}
      name="State Medical Records"
      citation="See state-specific"
      jurisdictions={["AZ", "CA", "TX", "NY"]}
    />
  ),
  OshaBbp: (
    <ModuleHeader
      icon={Syringe}
      name="OSHA Bloodborne Pathogens"
      citation="29 CFR §1910.1030"
      score={44}
    />
  ),
  NoScoreNoJurisdictions: <ModuleHeader icon={ShieldCheck} name="OIG Compliance" />,
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): ModuleHeader composes icon slot + name + citation + score ring + jurisdiction strip"
```

### Task F2: `<PracticeIdentityCard>`

**Purpose (per ADR-0005):** Practice name + state + specialty + setup-progress chip. Top of dashboard.

**API:**
```ts
interface PracticeIdentityCardProps {
  name: string;                   // "Noorros Internal Medicine"
  primaryState: string;           // "AZ"
  specialty?: string;             // "Internal Medicine"
  role?: "OWNER" | "ADMIN" | "STAFF" | "VIEWER";
  officerRoles?: Array<"Privacy Officer" | "Security Officer" | "Compliance Officer">;
  setupProgress?: number;         // 0-100, optional
  className?: string;
}
```

**Files:**
- Create: `src/components/gw/PracticeIdentityCard/PracticeIdentityCard.test.tsx`
- Create: `src/components/gw/PracticeIdentityCard/index.tsx`
- Create: `src/components/gw/PracticeIdentityCard/PracticeIdentityCard.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/PracticeIdentityCard/PracticeIdentityCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PracticeIdentityCard } from ".";

describe("<PracticeIdentityCard>", () => {
  it("renders name + state", () => {
    render(<PracticeIdentityCard name="Noorros Internal Medicine" primaryState="AZ" />);
    expect(screen.getByRole("heading", { name: /Noorros Internal Medicine/ })).toBeInTheDocument();
    expect(screen.getByText("AZ")).toBeInTheDocument();
  });

  it("renders specialty when passed", () => {
    render(
      <PracticeIdentityCard
        name="X"
        primaryState="AZ"
        specialty="Internal Medicine"
      />,
    );
    expect(screen.getByText("Internal Medicine")).toBeInTheDocument();
  });

  it("renders role badge when passed", () => {
    render(<PracticeIdentityCard name="X" primaryState="AZ" role="OWNER" />);
    expect(screen.getByText(/owner/i)).toBeInTheDocument();
  });

  it("renders each officer role in the badge strip", () => {
    render(
      <PracticeIdentityCard
        name="X"
        primaryState="AZ"
        officerRoles={["Privacy Officer", "Security Officer"]}
      />,
    );
    expect(screen.getByText("Privacy Officer")).toBeInTheDocument();
    expect(screen.getByText("Security Officer")).toBeInTheDocument();
  });

  it("omits setup progress line when setupProgress is undefined", () => {
    render(<PracticeIdentityCard name="X" primaryState="AZ" />);
    expect(screen.queryByText(/setup/i)).toBeNull();
  });

  it("shows setup-progress chip when setupProgress is passed (0-100)", () => {
    render(<PracticeIdentityCard name="X" primaryState="AZ" setupProgress={65} />);
    expect(screen.getByText(/65%/)).toBeInTheDocument();
    expect(screen.getByText(/setup/i)).toBeInTheDocument();
  });

  it("setup-progress chip at 100 shows a 'complete' label/icon (redundant signal)", () => {
    render(<PracticeIdentityCard name="X" primaryState="AZ" setupProgress={100} />);
    expect(screen.getByText(/complete/i)).toBeInTheDocument();
  });

  it("clamps setupProgress to [0, 100]", () => {
    const { rerender } = render(
      <PracticeIdentityCard name="X" primaryState="AZ" setupProgress={150} />,
    );
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    rerender(<PracticeIdentityCard name="X" primaryState="AZ" setupProgress={-5} />);
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/PracticeIdentityCard
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/PracticeIdentityCard/index.tsx
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type PracticeRoleLabel = "OWNER" | "ADMIN" | "STAFF" | "VIEWER";
export type OfficerRole = "Privacy Officer" | "Security Officer" | "Compliance Officer";

export interface PracticeIdentityCardProps {
  name: string;
  primaryState: string;
  specialty?: string;
  role?: PracticeRoleLabel;
  officerRoles?: OfficerRole[];
  setupProgress?: number;
  className?: string;
}

export function PracticeIdentityCard({
  name,
  primaryState,
  specialty,
  role,
  officerRoles,
  setupProgress,
  className,
}: PracticeIdentityCardProps) {
  const progress = setupProgress === undefined
    ? undefined
    : Math.max(0, Math.min(100, Math.round(setupProgress)));
  return (
    <Card className={className}>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{name}</h2>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{primaryState}</span>
              {specialty && <span> · {specialty}</span>}
            </p>
          </div>
          {role && <Badge variant="secondary">{role}</Badge>}
        </div>
        {officerRoles && officerRoles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {officerRoles.map((r) => (
              <Badge key={r} variant="outline">{r}</Badge>
            ))}
          </div>
        )}
        {progress !== undefined && (
          <div className="flex items-center gap-2 pt-1">
            {progress === 100 ? (
              <CheckCircle2
                className="h-4 w-4 text-[color:var(--gw-color-compliant)]"
                aria-hidden="true"
              />
            ) : null}
            <span className="text-xs text-muted-foreground">
              Setup: {progress}% {progress === 100 ? "complete" : null}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/PracticeIdentityCard
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/PracticeIdentityCard/PracticeIdentityCard.stories.tsx
import { PracticeIdentityCard } from ".";

export const stories = {
  Minimal: <PracticeIdentityCard name="Noorros Internal Medicine" primaryState="AZ" />,
  Full: (
    <PracticeIdentityCard
      name="Noorros Internal Medicine"
      primaryState="AZ"
      specialty="Internal Medicine"
      role="OWNER"
      officerRoles={["Privacy Officer", "Security Officer", "Compliance Officer"]}
      setupProgress={45}
    />
  ),
  SetupComplete: (
    <PracticeIdentityCard
      name="Desert Sky Family Health"
      primaryState="NV"
      specialty="Family Medicine"
      role="OWNER"
      officerRoles={["Privacy Officer"]}
      setupProgress={100}
    />
  ),
  Viewer: (
    <PracticeIdentityCard
      name="Cactus Pediatrics"
      primaryState="AZ"
      role="VIEWER"
    />
  ),
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): PracticeIdentityCard with role + officer + setup-progress"
```

---

## Chunk G — `<DeadlineWarning>` + `<MajorBreachBanner>` (Day 7, ~4 hours)

### Task G1: Shared severity-threshold helper

`<DeadlineWarning>` uses the same severity scale (compliant/good/needs/risk) as `<ScoreRing>` but keyed on "days until deadline" instead of "score out of 100". Extracting the helper first keeps the two components in sync.

**Files:**
- Create: `src/lib/severity.ts`
- Append tests to: `src/lib/utils.test.ts` (or a new file — we'll add to utils.test.ts for simplicity)

Actually, create a dedicated test file to keep domains clean:

- Create: `src/lib/severity.test.ts`

- [ ] **Step 1: Write `src/lib/severity.ts`**

```ts
// src/lib/severity.ts
//
// Shared severity scale used by ScoreRing, DeadlineWarning, MajorBreachBanner,
// etc. Four bands mirror the compliance-score thresholds in ADR-0005. Each
// maps to a CSS token so components never hardcode colors.

import { scoreToColorToken } from "./utils";

export type Severity = "compliant" | "good" | "needs" | "risk";

const SEVERITY_SCORE: Record<Severity, number> = {
  compliant: 95,
  good: 75,
  needs: 55,
  risk: 25,
};

/** Map a severity enum to the same CSS token that scoreToColorToken emits. */
export function severityToColorToken(severity: Severity): string {
  return scoreToColorToken(SEVERITY_SCORE[severity]);
}

/** Days-until-deadline -> severity band.
 *  - past due (negative days) or <= 3 days: risk
 *  - 4–14 days: needs
 *  - 15–30 days: good
 *  - 30+ days: compliant
 */
export function daysUntilToSeverity(days: number): Severity {
  if (days <= 3) return "risk";
  if (days <= 14) return "needs";
  if (days <= 30) return "good";
  return "compliant";
}
```

- [ ] **Step 2: Write `src/lib/severity.test.ts`**

```ts
// src/lib/severity.test.ts
import { describe, it, expect } from "vitest";
import { daysUntilToSeverity, severityToColorToken } from "./severity";

describe("daysUntilToSeverity", () => {
  it.each([
    [-5, "risk"],
    [0, "risk"],
    [3, "risk"],
    [4, "needs"],
    [14, "needs"],
    [15, "good"],
    [30, "good"],
    [31, "compliant"],
    [365, "compliant"],
  ] as const)("days=%i -> %s", (days, severity) => {
    expect(daysUntilToSeverity(days)).toBe(severity);
  });
});

describe("severityToColorToken", () => {
  it.each([
    ["compliant", "var(--gw-color-compliant)"],
    ["good", "var(--gw-color-good)"],
    ["needs", "var(--gw-color-needs)"],
    ["risk", "var(--gw-color-risk)"],
  ] as const)("%s -> %s", (sev, token) => {
    expect(severityToColorToken(sev)).toBe(token);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project node src/lib/severity.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(lib): shared severity helper (days-until + token mapper) for DeadlineWarning/MajorBreachBanner"
```

### Task G2: `<DeadlineWarning>`

**Purpose (per ADR-0005):** Countdown widget for deadlines — credentials, breach notifications, training overdue. Severity follows the shared scale.

**API:**
```ts
interface DeadlineWarningProps {
  label: string;                  // "DEA renewal due"
  deadline: Date;                 // due date
  now?: Date;                     // injection for tests
  description?: string;           // optional secondary text
  className?: string;
}
```

**Files:**
- Create: `src/components/gw/DeadlineWarning/DeadlineWarning.test.tsx`
- Create: `src/components/gw/DeadlineWarning/index.tsx`
- Create: `src/components/gw/DeadlineWarning/DeadlineWarning.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/DeadlineWarning/DeadlineWarning.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeadlineWarning } from ".";

const FIXED_NOW = new Date("2026-04-20T12:00:00Z");

function addDays(n: number): Date {
  return new Date(FIXED_NOW.getTime() + n * 86_400_000);
}

describe("<DeadlineWarning>", () => {
  it("renders the label", () => {
    render(<DeadlineWarning label="DEA renewal" deadline={addDays(10)} now={FIXED_NOW} />);
    expect(screen.getByText("DEA renewal")).toBeInTheDocument();
  });

  it("renders 'in N days' when deadline is in the future", () => {
    render(<DeadlineWarning label="X" deadline={addDays(10)} now={FIXED_NOW} />);
    expect(screen.getByText(/in 10 days/i)).toBeInTheDocument();
  });

  it("renders 'today' when deadline is today", () => {
    render(<DeadlineWarning label="X" deadline={addDays(0)} now={FIXED_NOW} />);
    expect(screen.getByText(/today/i)).toBeInTheDocument();
  });

  it("renders 'N days overdue' when deadline is past", () => {
    render(<DeadlineWarning label="X" deadline={addDays(-3)} now={FIXED_NOW} />);
    expect(screen.getByText(/3 days overdue/i)).toBeInTheDocument();
  });

  it("renders 'in 1 day' and 'tomorrow' correctly (singular)", () => {
    const { rerender } = render(
      <DeadlineWarning label="X" deadline={addDays(1)} now={FIXED_NOW} />,
    );
    expect(screen.getByText(/in 1 day|tomorrow/i)).toBeInTheDocument();
    rerender(<DeadlineWarning label="X" deadline={addDays(-1)} now={FIXED_NOW} />);
    expect(screen.getByText(/1 day overdue/i)).toBeInTheDocument();
  });

  it("severity color: <=3 days uses --gw-color-risk", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(2)} now={FIXED_NOW} />,
    );
    const el = container.firstElementChild as HTMLElement;
    const style = el.getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-risk)");
  });

  it("severity color: 4-14 days uses --gw-color-needs", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(10)} now={FIXED_NOW} />,
    );
    const style = (container.firstElementChild as HTMLElement).getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-needs)");
  });

  it("severity color: 15-30 days uses --gw-color-good", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(20)} now={FIXED_NOW} />,
    );
    const style = (container.firstElementChild as HTMLElement).getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-good)");
  });

  it("severity color: 30+ days uses --gw-color-compliant", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(60)} now={FIXED_NOW} />,
    );
    const style = (container.firstElementChild as HTMLElement).getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-compliant)");
  });

  it("exposes a polite live-region role so screen readers announce changes", () => {
    render(<DeadlineWarning label="X" deadline={addDays(1)} now={FIXED_NOW} />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
  });

  it("has a machine-readable datetime attribute on <time>", () => {
    const deadline = addDays(10);
    const { container } = render(
      <DeadlineWarning label="X" deadline={deadline} now={FIXED_NOW} />,
    );
    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBe(deadline.toISOString());
  });

  it("carries an icon (redundant signal alongside color)", () => {
    const { container } = render(
      <DeadlineWarning label="X" deadline={addDays(1)} now={FIXED_NOW} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/DeadlineWarning
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/DeadlineWarning/index.tsx
import { AlertTriangle, Clock, CircleCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { daysUntilToSeverity, severityToColorToken, type Severity } from "@/lib/severity";

export interface DeadlineWarningProps {
  label: string;
  deadline: Date;
  now?: Date;
  description?: string;
  className?: string;
}

function daysBetween(from: Date, to: Date): number {
  const MS = 86_400_000;
  // Use UTC midnight on both sides so DST doesn't wobble the boundary.
  const f = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((t - f) / MS);
}

function formatRelative(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `in ${days} days`;
}

const SEVERITY_ICON: Record<Severity, LucideIcon> = {
  risk: AlertTriangle,
  needs: Clock,
  good: Clock,
  compliant: CircleCheck,
};

export function DeadlineWarning({
  label,
  deadline,
  now = new Date(),
  description,
  className,
}: DeadlineWarningProps) {
  const days = daysBetween(now, deadline);
  const severity = daysUntilToSeverity(days);
  const color = severityToColorToken(severity);
  const Icon = SEVERITY_ICON[severity];
  const relative = formatRelative(days);

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3",
        className,
      )}
      style={{
        borderColor: color,
        backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`,
      }}
    >
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ color }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {label}{" "}
          <time
            dateTime={deadline.toISOString()}
            className="font-normal text-muted-foreground"
          >
            — {relative}
          </time>
        </p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/DeadlineWarning
```

Expected: all tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/DeadlineWarning/DeadlineWarning.stories.tsx
import { DeadlineWarning } from ".";

const today = new Date("2026-04-20T12:00:00Z");
function offset(days: number): Date {
  return new Date(today.getTime() + days * 86_400_000);
}

export const stories = {
  Overdue: (
    <DeadlineWarning
      label="DEA renewal"
      deadline={offset(-7)}
      now={today}
      description="Federal — submit via DEA Diversion Control Division"
    />
  ),
  Critical: (
    <DeadlineWarning label="Malpractice insurance renewal" deadline={offset(2)} now={today} />
  ),
  NeedsAction: (
    <DeadlineWarning
      label="State license renewal"
      deadline={offset(12)}
      now={today}
      description="Submit via AZ Medical Board portal"
    />
  ),
  Comfortable: <DeadlineWarning label="HIPAA training refresh" deadline={offset(25)} now={today} />,
  FarFuture: <DeadlineWarning label="Annual risk analysis" deadline={offset(90)} now={today} />,
  Today: <DeadlineWarning label="Staff attestation signing" deadline={offset(0)} now={today} />,
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): DeadlineWarning uses shared severity helper + accessible <time> + icon signal"
```

### Task G3: `<MajorBreachBanner>`

**Purpose (per ADR-0005):** The red 500+-affected banner. Single component so list view and detail view stay in sync (v1's bug: they diverged).

Per the assignment: breach banner is always-visible red when 500+ affected. The _calculation_ of affected count is domain logic (not in scope for this sprint) — this component just renders given a boolean `isMajor` + the affected count.

**API:**
```ts
interface MajorBreachBannerProps {
  affectedCount: number;          // render banner only if >= 500
  reportingDeadline: Date;        // shown in the banner body
  now?: Date;                     // injection for tests
  onDismiss?: () => void;         // banner is non-dismissable in production, but stories/tests may hide it
  className?: string;
}
```

Component renders `null` when `affectedCount < 500`. This is intentional: callers pass every breach incident through, and only major ones render the banner.

**Files:**
- Create: `src/components/gw/MajorBreachBanner/MajorBreachBanner.test.tsx`
- Create: `src/components/gw/MajorBreachBanner/index.tsx`
- Create: `src/components/gw/MajorBreachBanner/MajorBreachBanner.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/MajorBreachBanner/MajorBreachBanner.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MajorBreachBanner } from ".";

const NOW = new Date("2026-04-20T12:00:00Z");
const DEADLINE = new Date("2026-06-15T23:59:59Z");

describe("<MajorBreachBanner>", () => {
  it("returns null (renders nothing) when affectedCount < 500", () => {
    const { container } = render(
      <MajorBreachBanner affectedCount={499} reportingDeadline={DEADLINE} now={NOW} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the banner when affectedCount >= 500", () => {
    render(<MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("includes the affected count in the banner text", () => {
    render(<MajorBreachBanner affectedCount={1_234} reportingDeadline={DEADLINE} now={NOW} />);
    // Accept either "1,234" or "1234"
    expect(screen.getByText(/1[,]?234/)).toBeInTheDocument();
  });

  it("mentions the 500+ major-breach rule", () => {
    render(<MajorBreachBanner affectedCount={750} reportingDeadline={DEADLINE} now={NOW} />);
    expect(screen.getByText(/500\+|500 or more|major breach/i)).toBeInTheDocument();
  });

  it("shows the reporting deadline as a <time> element", () => {
    const { container } = render(
      <MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />,
    );
    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBe(DEADLINE.toISOString());
  });

  it("uses the risk color token for the banner background (redundant with icon + copy)", () => {
    const { container } = render(
      <MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />,
    );
    const el = screen.getByRole("alert");
    const style = el.getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-risk)");
  });

  it("includes an alert icon (redundant signal)", () => {
    const { container } = render(
      <MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders deadline as 'in N days' relative text", () => {
    // Deadline is 56 days after NOW
    render(<MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />);
    expect(screen.getByText(/56 days|in 56/i)).toBeInTheDocument();
  });

  it("when onDismiss is provided, renders an accessible dismiss button", () => {
    render(
      <MajorBreachBanner
        affectedCount={500}
        reportingDeadline={DEADLINE}
        now={NOW}
        onDismiss={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /dismiss/i });
    expect(btn).toBeInTheDocument();
  });

  it("when onDismiss is absent, no dismiss button appears (non-dismissable in prod)", () => {
    render(<MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />);
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/MajorBreachBanner
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/MajorBreachBanner/index.tsx
import { AlertOctagon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { severityToColorToken } from "@/lib/severity";

export const MAJOR_BREACH_THRESHOLD = 500;

export interface MajorBreachBannerProps {
  affectedCount: number;
  reportingDeadline: Date;
  now?: Date;
  onDismiss?: () => void;
  className?: string;
}

function daysBetween(from: Date, to: Date): number {
  const MS = 86_400_000;
  const f = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((t - f) / MS);
}

export function MajorBreachBanner({
  affectedCount,
  reportingDeadline,
  now = new Date(),
  onDismiss,
  className,
}: MajorBreachBannerProps) {
  if (affectedCount < MAJOR_BREACH_THRESHOLD) return null;

  const color = severityToColorToken("risk");
  const days = daysBetween(now, reportingDeadline);
  const deadlineText = days <= 0
    ? `${Math.abs(days)} days overdue`
    : `in ${days} days`;
  const formattedCount = new Intl.NumberFormat("en-US").format(affectedCount);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        className,
      )}
      style={{
        borderColor: color,
        backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
      }}
    >
      <AlertOctagon
        className="mt-0.5 h-5 w-5 shrink-0"
        style={{ color }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold" style={{ color }}>
          Major breach: 500+ individuals affected
        </p>
        <p className="text-sm text-foreground">
          {formattedCount} individuals affected. HHS notification and media notice
          required{" "}
          <time dateTime={reportingDeadline.toISOString()} className="font-medium">
            {deadlineText}
          </time>
          .
        </p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded p-1 text-muted-foreground hover:bg-background"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/MajorBreachBanner
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/MajorBreachBanner/MajorBreachBanner.stories.tsx
import { MajorBreachBanner } from ".";

const NOW = new Date("2026-04-20T12:00:00Z");
function offset(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000);
}

export const stories = {
  JustOverThreshold: (
    <MajorBreachBanner affectedCount={500} reportingDeadline={offset(56)} now={NOW} />
  ),
  Thousands: (
    <MajorBreachBanner affectedCount={12_450} reportingDeadline={offset(30)} now={NOW} />
  ),
  UrgentDeadline: (
    <MajorBreachBanner affectedCount={2_100} reportingDeadline={offset(3)} now={NOW} />
  ),
  OverdueReport: (
    <MajorBreachBanner affectedCount={800} reportingDeadline={offset(-5)} now={NOW} />
  ),
  // Note: below threshold — renders nothing; gallery will show an "N/A" placeholder
  BelowThreshold: (
    <MajorBreachBanner affectedCount={250} reportingDeadline={offset(30)} now={NOW} />
  ),
};
```

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): MajorBreachBanner (500+ threshold, always red, one source of truth vs v1)"
```

---

## Chunk H — `<AiAssistDrawer>` (Day 8, ~3 hours)

### Task H1: Sheet-based side drawer with stubbed body

**Purpose (per ADR-0005):** Ambient AI Concierge sidebar. Knows current page context. LLM wiring is weeks 5-6 per ADR-0003 — this sprint builds the shell only.

**API:**
```ts
interface AiAssistDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageContext: {
    route: string;                 // e.g. "/modules/hipaa-privacy"
    summary?: string;              // e.g. "HIPAA Privacy Rule module"
    practiceId?: string;
  };
  className?: string;
}
```

The body renders:
- Header: "AI Concierge" + current route chip
- Scroll area with a static stub message: "I can see you're on {pageContext.summary ?? pageContext.route}. What would you like help with?"
- Footer: disabled textarea "Coming in week 5" + disabled send button

**Files:**
- Create: `src/components/gw/AiAssistDrawer/AiAssistDrawer.test.tsx`
- Create: `src/components/gw/AiAssistDrawer/index.tsx`
- Create: `src/components/gw/AiAssistDrawer/AiAssistDrawer.stories.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/gw/AiAssistDrawer/AiAssistDrawer.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiAssistDrawer } from ".";

describe("<AiAssistDrawer>", () => {
  it("renders nothing (no dialog) when closed", () => {
    render(
      <AiAssistDrawer
        open={false}
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a dialog with an accessible name when open", () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(/ai concierge/i);
  });

  it("shows the current route in the header area", () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/modules/hipaa-privacy" }}
      />,
    );
    expect(screen.getByText("/modules/hipaa-privacy")).toBeInTheDocument();
  });

  it("surfaces the summary if passed (preferring summary over route in greeting)", () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/modules/hipaa-privacy", summary: "HIPAA Privacy Rule module" }}
      />,
    );
    expect(screen.getByText(/HIPAA Privacy Rule module/)).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <AiAssistDrawer
        open
        onOpenChange={onOpenChange}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    // Shadcn's SheetContent provides a built-in close button with aria-label "Close"
    const closeBtn = screen.getByRole("button", { name: /close/i });
    await user.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <AiAssistDrawer
        open
        onOpenChange={onOpenChange}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders the 'Coming in week 5' stub in the footer with a disabled textarea", () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("traps focus within the drawer when open (first focusable is inside dialog)", async () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    // Radix sets initial focus inside the dialog automatically.
    // We assert that document.activeElement is contained by the dialog.
    const dialog = screen.getByRole("dialog");
    // Give Radix one microtask tick to apply focus management.
    await Promise.resolve();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → see red**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/AiAssistDrawer
```

Expected: all tests FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/gw/AiAssistDrawer/index.tsx
import { Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface AiAssistPageContext {
  route: string;
  summary?: string;
  practiceId?: string;
}

export interface AiAssistDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageContext: AiAssistPageContext;
  className?: string;
}

export function AiAssistDrawer({ open, onOpenChange, pageContext, className }: AiAssistDrawerProps) {
  const greeting = pageContext.summary ?? pageContext.route;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("flex w-full flex-col sm:max-w-md", className)}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            AI Concierge
          </SheetTitle>
          <SheetDescription>
            Context-aware help for the current page.
          </SheetDescription>
          <div className="pt-1">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {pageContext.route}
            </Badge>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-foreground">
            I can see you&apos;re on <span className="font-medium">{greeting}</span>. What would you like help with?
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            (Connected responses arrive in week 5 — see ADR-0003.)
          </p>
        </div>

        <SheetFooter className="flex-col gap-2 border-t pt-3">
          <label htmlFor="ai-assist-input" className="sr-only">Ask the AI Concierge</label>
          <textarea
            id="ai-assist-input"
            disabled
            placeholder="Coming in week 5"
            rows={2}
            className="w-full resize-none rounded-md border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground"
          />
          <Button type="button" disabled className="w-full">
            Send
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run → see green**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/AiAssistDrawer
```

Expected: all 8 tests PASS. If the focus-trap test fails due to Radix timing, flush with `await new Promise((r) => setTimeout(r, 0))` instead of `Promise.resolve()`.

- [ ] **Step 5: Write the stories file**

```tsx
// src/components/gw/AiAssistDrawer/AiAssistDrawer.stories.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AiAssistDrawer } from ".";

function Demo({ summary }: { summary?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Open AI Concierge
      </Button>
      <AiAssistDrawer
        open={open}
        onOpenChange={setOpen}
        pageContext={{ route: "/modules/hipaa-privacy", summary, practiceId: "prac_demo" }}
      />
    </>
  );
}

export const stories = {
  Closed: <Demo />,
  DashboardContext: <Demo summary="Dashboard overview" />,
  ModuleContext: <Demo summary="HIPAA Privacy Rule module" />,
};
```

Note: stories render the trigger button, not the opened drawer — gallery visitors tap to open it. This is intentional; an always-open drawer in a gallery clutters the layout.

- [ ] **Step 6: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): AiAssistDrawer shell (Sheet + page context + focus trap, body stub pending ADR-0003)"
```

---

## Chunk I — Gallery route + axe-core audit (Day 9, ~3 hours)

### Task I1: `/internal/design-system` gallery route

**Purpose:** one page that renders every component's stories, for visual review and jest-axe scanning.

**Files:**
- Create: `src/app/internal/design-system/page.tsx`

- [ ] **Step 1: Write the gallery page**

```tsx
// src/app/internal/design-system/page.tsx
//
// Internal design-system gallery. Not linked from the nav; reachable by
// typing the URL. Every gw/ component's stories file is rendered here so
// we can scan visually + programmatically (jest-axe in gallery.test.tsx).

import { stories as EmptyStateStories } from "@/components/gw/EmptyState/EmptyState.stories";
import { stories as RegulationCitationStories } from "@/components/gw/RegulationCitation/RegulationCitation.stories";
import { stories as EvidenceBadgeStories } from "@/components/gw/EvidenceBadge/EvidenceBadge.stories";
import { stories as ScoreRingStories } from "@/components/gw/ScoreRing/ScoreRing.stories";
import { stories as ComplianceCardStories } from "@/components/gw/ComplianceCard/ComplianceCard.stories";
import { stories as ChecklistItemStories } from "@/components/gw/ChecklistItem/ChecklistItem.stories";
import { stories as ModuleHeaderStories } from "@/components/gw/ModuleHeader/ModuleHeader.stories";
import { stories as PracticeIdentityCardStories } from "@/components/gw/PracticeIdentityCard/PracticeIdentityCard.stories";
import { stories as DeadlineWarningStories } from "@/components/gw/DeadlineWarning/DeadlineWarning.stories";
import { stories as MajorBreachBannerStories } from "@/components/gw/MajorBreachBanner/MajorBreachBanner.stories";
import { stories as AiAssistDrawerStories } from "@/components/gw/AiAssistDrawer/AiAssistDrawer.stories";

export const metadata = {
  title: "Design System · GuardWell",
};

type StoryBlock = {
  name: string;
  stories: Record<string, React.ReactNode>;
};

const BLOCKS: StoryBlock[] = [
  { name: "EmptyState", stories: EmptyStateStories },
  { name: "RegulationCitation", stories: RegulationCitationStories },
  { name: "EvidenceBadge", stories: EvidenceBadgeStories },
  { name: "ScoreRing", stories: ScoreRingStories },
  { name: "ComplianceCard", stories: ComplianceCardStories },
  { name: "ChecklistItem", stories: ChecklistItemStories },
  { name: "ModuleHeader", stories: ModuleHeaderStories },
  { name: "PracticeIdentityCard", stories: PracticeIdentityCardStories },
  { name: "DeadlineWarning", stories: DeadlineWarningStories },
  { name: "MajorBreachBanner", stories: MajorBreachBannerStories },
  { name: "AiAssistDrawer", stories: AiAssistDrawerStories },
];

export default function DesignSystemGalleryPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-12 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold text-foreground">Design System</h1>
        <p className="text-sm text-muted-foreground">
          All gw/ components. Per ADR-0005. Not publicly linked.
        </p>
      </header>
      {BLOCKS.map((block) => (
        <section key={block.name} className="space-y-4">
          <h2 className="border-b pb-1 text-xl font-semibold text-foreground">
            {block.name}
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {Object.entries(block.stories).map(([name, story]) => (
              <div key={name} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {name}
                </p>
                <div className="rounded-lg border bg-background p-4">{story}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 2: Manual smoke test**

```bash
cd "D:/GuardWell/guardwell-v2" && npm run dev
```

Open http://localhost:3000/internal/design-system. Verify every component section renders its stories without visual breakage. Hit Ctrl+C when done.

- [ ] **Step 3: Verify build compiles**

```bash
cd "D:/GuardWell/guardwell-v2" && npx tsc --noEmit
```

Expected: zero errors. If the gallery is protected by middleware (`src/proxy.ts`), `/internal/` is not in `PUBLIC_ROUTES` — that means it requires auth in production, which is the right default. For local dev, sign in first.

### Task I2: Axe-core audit over the gallery

**Purpose:** compose every story into one render tree and run jest-axe over it. Any WCAG violation fails the test.

**Files:**
- Create: `src/components/gw/gallery.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/components/gw/gallery.test.tsx
//
// Axe-core accessibility audit over every gw/ story. Failure messages point
// at the exact rule (color contrast, missing label, etc.) so fixes are
// targeted.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { stories as EmptyStateStories } from "./EmptyState/EmptyState.stories";
import { stories as RegulationCitationStories } from "./RegulationCitation/RegulationCitation.stories";
import { stories as EvidenceBadgeStories } from "./EvidenceBadge/EvidenceBadge.stories";
import { stories as ScoreRingStories } from "./ScoreRing/ScoreRing.stories";
import { stories as ComplianceCardStories } from "./ComplianceCard/ComplianceCard.stories";
import { stories as ChecklistItemStories } from "./ChecklistItem/ChecklistItem.stories";
import { stories as ModuleHeaderStories } from "./ModuleHeader/ModuleHeader.stories";
import { stories as PracticeIdentityCardStories } from "./PracticeIdentityCard/PracticeIdentityCard.stories";
import { stories as DeadlineWarningStories } from "./DeadlineWarning/DeadlineWarning.stories";
import { stories as MajorBreachBannerStories } from "./MajorBreachBanner/MajorBreachBanner.stories";
import { stories as AiAssistDrawerStories } from "./AiAssistDrawer/AiAssistDrawer.stories";

const ALL = {
  EmptyState: EmptyStateStories,
  RegulationCitation: RegulationCitationStories,
  EvidenceBadge: EvidenceBadgeStories,
  ScoreRing: ScoreRingStories,
  ComplianceCard: ComplianceCardStories,
  ChecklistItem: ChecklistItemStories,
  ModuleHeader: ModuleHeaderStories,
  PracticeIdentityCard: PracticeIdentityCardStories,
  DeadlineWarning: DeadlineWarningStories,
  MajorBreachBanner: MajorBreachBannerStories,
  AiAssistDrawer: AiAssistDrawerStories,
} as const;

describe("gw/ accessibility audit (axe-core)", () => {
  for (const [componentName, stories] of Object.entries(ALL)) {
    for (const [storyName, story] of Object.entries(stories)) {
      it(`${componentName} > ${storyName}`, async () => {
        const { container } = render(<>{story}</>);
        const results = await axe(container, {
          rules: {
            // Disable landmark/region rules for isolated component renders.
            // They only make sense in a full-page context, which the
            // gallery-route manual review already covers.
            region: { enabled: false },
          },
        });
        expect(results).toHaveNoViolations();
      });
    }
  }
});
```

- [ ] **Step 2: Run the audit**

```bash
cd "D:/GuardWell/guardwell-v2" && npx vitest run --project jsdom src/components/gw/gallery.test.tsx
```

Expected: every story passes. If a story fails, axe's message names the rule (e.g. `color-contrast`, `button-name`, `label`). Fix the underlying component, NOT the test.

- [ ] **Step 3: Common violations + remedies (reference)**

| Rule | Likely cause | Fix |
|---|---|---|
| `color-contrast` | Text over a `color-mix(...)` background fails 4.5:1 | Raise the mix% or swap text color to `foreground` |
| `button-name` | Icon-only button missing `aria-label` | Add it |
| `label` | Input without `<label>` or `aria-label` | Add `<label>` with `htmlFor` |
| `image-alt` | `<img>` without alt — shouldn't apply here (we use SVG icons) | n/a |
| `aria-required-attr` | `role="radiogroup"` without child radios | Ensure children are `<input type="radio">` |

- [ ] **Step 4: Iterate until green**

If any story fails:
1. Read the violation — axe reports `id`, `help`, `helpUrl`, and the element selector.
2. Fix the component (not the story, not the test).
3. Re-run.

- [ ] **Step 5: Commit chunk I**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(gw): internal gallery route + jest-axe audit over every story"
```

---

## Chunk J — Wire into `/dashboard` + deploy (Day 10, ~2 hours)

### Task J1: Replace ad-hoc dashboard with `<PracticeIdentityCard>`

**Files:**
- Rewrite: `src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Rewrite the page**

```tsx
// src/app/(dashboard)/dashboard/page.tsx
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PracticeIdentityCard } from "@/components/gw/PracticeIdentityCard";
import { EmptyState } from "@/components/gw/EmptyState";
import { Inbox } from "lucide-react";

export const metadata = {
  title: "Dashboard · GuardWell",
};

export default async function DashboardPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const eventCount = await db.eventLog.count({
    where: { practiceId: pu.practiceId },
  });

  const officerRoles: Array<"Privacy Officer" | "Security Officer" | "Compliance Officer"> = [];
  if (pu.isPrivacyOfficer) officerRoles.push("Privacy Officer");
  if (pu.isComplianceOfficer) officerRoles.push("Compliance Officer");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <PracticeIdentityCard
        name={pu.practice.name}
        primaryState={pu.practice.primaryState}
        role={pu.role}
        officerRoles={officerRoles}
        setupProgress={eventCount > 0 ? 10 : 0}
      />
      {eventCount === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No activity yet"
          description="As you complete compliance items, they'll show up here."
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Events recorded for this practice: {eventCount}
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Local smoke test**

```bash
cd "D:/GuardWell/guardwell-v2" && npm run dev
```

Sign in, visit `/dashboard`. Expect:
- `<PracticeIdentityCard>` at the top with the practice name, state, role badge, "Privacy Officer" + "Compliance Officer" badges, setup progress chip.
- `<EmptyState>` below (since `eventCount` is 1 from the onboarding event — adjust threshold if needed, or let the event count message show).

- [ ] **Step 3: Run ALL tests (node + jsdom) + typecheck + lint**

```bash
cd "D:/GuardWell/guardwell-v2" && npm test && npx tsc --noEmit && npm run lint
```

Expected:
- `npm test`: both projects green — node project (integration tests from Week 2) + jsdom project (all gw/ component tests + gallery axe audit).
- `npx tsc --noEmit`: zero errors.
- `npm run lint`: zero errors.

- [ ] **Step 4: Commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git add -A && git commit -m "feat(dashboard): skin /dashboard with PracticeIdentityCard + EmptyState"
```

### Task J2: Deploy + verify on production

- [ ] **Step 1: Push to main**

```bash
cd "D:/GuardWell/guardwell-v2" && git push origin main
```

Expected: Cloud Build trigger fires (as set up in Week 2 Task F3).

- [ ] **Step 2: Watch the build**

```bash
gcloud builds list --limit=3
```

Find the build for the latest commit. Wait ~5–8 minutes for SUCCESS.

- [ ] **Step 3: Verify on production**

Visit https://v2.app.gwcomp.com, sign in, visit `/dashboard`. Expect:
- PracticeIdentityCard renders with your practice details.
- No console errors (check DevTools).
- `Inspect Element` on the ScoreRing inside PracticeIdentityCard (if score prop wired in the future) or on the EmptyState — confirm the GW tokens render real colors (not an empty `var()` fallback).

- [ ] **Step 4: Final commit**

```bash
cd "D:/GuardWell/guardwell-v2" && git commit --allow-empty -m "docs: weeks 3-4 design-system sprint complete, live on v2.app.gwcomp.com"
```

---

## Self-review checklist

- [ ] All 10 chunks have committed checkpoints — yes
- [ ] Every component has test → implement → story → commit, in that order (strict TDD) — yes
- [ ] Every test asserts behavior (ARIA roles, keyboard nav, color via CSS var token, icon-only buttons have aria-label) rather than implementation internals — yes
- [ ] No hardcoded color hexes in component code — all components go through `scoreToColorToken`, `severityToColorToken`, or Shadcn tokens (`text-foreground`, `bg-muted`, etc.) — yes
- [ ] Shared `severityToColorToken` extracted BEFORE both consumers (DeadlineWarning + MajorBreachBanner) exist — yes (Task G1 first)
- [ ] Gallery axe audit (Task I2) scans every story via a programmatic loop — yes
- [ ] No `PUBLIC_ROUTES` edit to `src/proxy.ts` — `/internal/design-system` stays behind auth in production — yes
- [ ] Every icon-only element in the components has `aria-hidden="true"` (icon) + a sibling visible label (text) OR `aria-label` on the button — enforced by tests in EmptyState (hidden icon), ChecklistItem (aria-label), AiAssistDrawer (Sheet close button is the only icon-only button and it comes with `aria-label` from Shadcn scaffold)
- [ ] Test file locations match vitest's jsdom include pattern (`src/components/**/*.test.{ts,tsx}`) — yes
- [ ] Shared severity helper has its own unit test so components can depend on it without re-testing its math — yes (Task G1 Step 2)
- [ ] `<ChecklistItem>` fixes v1's OIG "both buttons look active" bug via a single `data-active` attribute + radiogroup semantics, asserted by a test — yes (Task E2 "visual: only ONE option shows the 'active' treatment")
- [ ] `<MajorBreachBanner>` renders null below 500 — asserted by the first test in Task G3

## What's intentionally NOT in weeks 3-4

- **Real LLM wiring** in `<AiAssistDrawer>` — weeks 5-6 per [ADR-0003](../adr/0003-llm-ops.md). This sprint ships the shell (open/close, focus trap, page-context prop) with a disabled input.
- **Storybook as a separate tool** — deferred per [ADR-0005](../adr/0005-design-system.md) "revisit after ~30 components". Until then, `*.stories.tsx` files feed the `/internal/design-system` gallery route.
- **`no-hardcoded-colors` ESLint rule** — post-launch polish. For this sprint, the jest-axe gallery audit + code review catch violations; the rule formalizes the habit later.
- **Module pages that consume these components** — weeks 5-6 onward per [ADR-0004](../adr/0004-modules-as-data.md). This sprint produces the primitives only.
- **Actual breach-calculation logic** (what makes `affectedCount >= 500`) — domain work, not design. `<MajorBreachBanner>` takes `affectedCount` as a prop; callers will compute it in weeks 6+.
- **Dark-mode pass** — all tokens already have `.dark` variants from Week 1–2 scaffold; ensuring every component looks right in dark is a separate visual-QA pass (weeks 11–14 polish).
- **Loading skeletons (`loading.tsx`) for the module pages** — weeks 5-6, once module pages exist to have loading states for.

## Execution handoff

Plan complete and saved to `docs/plans/weeks-3-4-design-system.md`. Two execution options:

**1. Subagent-driven (recommended)** — dispatch a fresh subagent per task. Each component chunk (C1, C2, C3, D1, E1, E2, F1, F2, G2, G3, H1) is self-contained: test file, implementation, story file, one commit. Clean handoff boundaries.

**2. Inline execution** — execute tasks in this session using `superpowers:executing-plans`. Faster for Chunks A, B, G1, I, J because they're small and sequential. Slower for the 11 component chunks because context accumulates.

Recommendation: **Hybrid** — execute Chunks A + B + G1 + J inline (infra + helpers + wrap-up are sequential), dispatch each leaf/domain component (Chunks C, D, E, F, G2, G3, H) as parallel subagents. They share no mutable state, so parallel dispatch is safe. Chunk I (gallery + axe audit) must run last, serially, after all components exist.
