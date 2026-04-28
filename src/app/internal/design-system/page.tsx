"use client";

// src/app/internal/design-system/page.tsx
//
// Internal design-system gallery. Not linked from the nav; reachable by
// typing the URL. Client component because several story fragments
// carry interactive props (onClick, onStatusChange) that can't flow
// through a server component boundary. Every gw/ component's stories
// file is rendered here so we can scan visually + programmatically
// (jest-axe in gallery.test.tsx).

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
import { stories as EvidenceUploaderStories } from "@/components/gw/EvidenceUploader/EvidenceUploader.stories";
import { stories as EvidenceListStories } from "@/components/gw/EvidenceList/EvidenceList.stories";

// NB: metadata export isn't allowed on a "use client" page. The gallery
// is internal-only (behind auth) so skipping a custom <title> is fine —
// the root layout's title template kicks in.

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
  { name: "EvidenceUploader", stories: EvidenceUploaderStories },
  { name: "EvidenceList", stories: EvidenceListStories },
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
