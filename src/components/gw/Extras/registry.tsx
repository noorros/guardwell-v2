// src/components/gw/Extras/registry.tsx
//
// Per-framework "Extras" components that render in Section G of the
// /modules/[code] page (per docs/specs/module-page-contract.md). Each
// Extras component is a small, framework-specific helper — calculator,
// template picker, quick reference — that doesn't fit the generic
// requirement-list shell.
//
// Adding a new framework's Extras:
//   1. Build a client component under this folder, e.g. `OshaExtras.tsx`
//   2. Import it below
//   3. Add an entry to `EXTRAS_BY_FRAMEWORK_CODE`
//   4. The `/modules/[code]` page will render it automatically.
//
// Components must be self-contained (no server-action calls that would
// require a server-only import); they may post events through normal
// server actions just like any other client island.

import type { JSX } from "react";
import { HipaaExtras } from "./HipaaExtras";
import { OshaExtras } from "./OshaExtras";
import { OigExtras } from "./OigExtras";
import { CmsExtras } from "./CmsExtras";
import { DeaExtras } from "./DeaExtras";
import { CliaExtras } from "./CliaExtras";
import { MacraExtras } from "./MacraExtras";
import { TcpaExtras } from "./TcpaExtras";
import { AllergyExtras } from "./AllergyExtras";

export interface ExtrasComponentProps {
  practiceName: string;
  practicePrimaryState: string;
  practiceProviderCount: string | null;
}

type ExtrasComponent = (props: ExtrasComponentProps) => JSX.Element;

// Keyed by RegulatoryFramework.code (UPPERCASE). Frameworks without a
// registered component render nothing in Section G — that's the empty
// default for operational frameworks (Training, Policies, Risk, etc.)
// whose work happens on dedicated /programs/* pages.
export const EXTRAS_BY_FRAMEWORK_CODE: Record<string, ExtrasComponent> = {
  HIPAA: HipaaExtras,
  OSHA: OshaExtras,
  OIG: OigExtras,
  CMS: CmsExtras,
  DEA: DeaExtras,
  CLIA: CliaExtras,
  MACRA: MacraExtras,
  TCPA: TcpaExtras,
  ALLERGY: AllergyExtras,
};
