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
