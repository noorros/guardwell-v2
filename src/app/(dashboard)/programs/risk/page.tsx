// src/app/(dashboard)/programs/risk/page.tsx
//
// Phase 5 PR 5 — 4-tab Risk & CAP dashboard. The legacy page (which
// surfaced only the SRA history and CTA) is now scoped into the "SRA"
// tab via <SraTabContent>. Three new tabs: Risk Register (auto-generated
// + manual rows), Tech Assessment, and CAP (PR 6 will fill out).
//
// Routing: SRA detail still lives at /programs/risk/[id]; RiskItem
// detail at /programs/risk/items/[id]; CAP detail at
// /programs/risk/cap/[id] (PR 6). This avoids renaming the existing SRA
// detail route and keeps the wizard router.push targets stable.

import { ShieldAlert } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { RiskRegisterTab, type RiskRegisterRow } from "./RiskRegisterTab";
import { SraTabContent } from "./SraTabContent";
import { TechTabContent } from "./TechTabContent";
import { CapTab } from "./CapTab";

export const metadata = { title: "Risk & CAP · My Programs" };
export const dynamic = "force-dynamic";

interface SearchParams {
  tab?: string;
  severity?: string;
  source?: string;
  status?: string;
}

const KNOWN_TABS = new Set(["register", "sra", "tech", "cap"]);

export default async function RiskPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const sp = (await searchParams) ?? {};
  const tab = sp.tab && KNOWN_TABS.has(sp.tab) ? sp.tab : "register";

  // Parallel queries powering all four tabs.
  const [
    riskItems,
    sraCompleted,
    sraDraft,
    taCompleted,
    taDraft,
    caps,
  ] = await Promise.all([
    db.riskItem.findMany({
      where: { practiceId: pu.practiceId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.practiceSraAssessment.findMany({
      where: {
        practiceId: pu.practiceId,
        isDraft: false,
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      take: 20,
    }),
    db.practiceSraAssessment.findFirst({
      where: { practiceId: pu.practiceId, isDraft: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.techAssessment.findMany({
      where: {
        practiceId: pu.practiceId,
        isDraft: false,
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      take: 20,
    }),
    db.techAssessment.findFirst({
      where: { practiceId: pu.practiceId, isDraft: true },
      orderBy: { updatedAt: "desc" },
    }),
    // Phase 5 PR 6 — CAP tab now renders the full timeline (including
    // COMPLETED rows). Sort moves to the client (CapTab does its own
    // OVERDUE-first/dueDate-asc/createdAt-desc grouping).
    db.correctiveAction.findMany({
      where: { practiceId: pu.practiceId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const openRiskCount = riskItems.filter((r) => r.status === "OPEN").length;
  const openCapCount = caps.filter((c) => c.status !== "COMPLETED").length;

  // Hydrate the register view-model. Dates -> ISO strings so the client
  // component can render without re-receiving Date objects (which Next
  // serializes anyway, but typing the prop as `string` makes the
  // component reusable in tests without a server round-trip).
  const registerRows: RiskRegisterRow[] = riskItems.map((r) => ({
    id: r.id,
    source: r.source,
    severity: r.severity,
    title: r.title,
    category: r.category,
    status: r.status,
    createdAtIso: r.createdAt.toISOString(),
  }));

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "Risk & CAP" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Risk &amp; CAP
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Risk register, SRA + Tech Assessment history, and corrective
            actions for your practice. Risks auto-generate from any
            NO/PARTIAL answer when you submit an assessment.
          </p>
        </div>
      </header>

      <Tabs defaultValue={tab}>
        <TabsList className="h-auto">
          <TabsTrigger value="register">
            Risk Register ({openRiskCount})
          </TabsTrigger>
          <TabsTrigger value="sra">SRA</TabsTrigger>
          <TabsTrigger value="tech">Tech Assessment</TabsTrigger>
          <TabsTrigger value="cap">CAP ({openCapCount})</TabsTrigger>
        </TabsList>

        <TabsContent value="register">
          <RiskRegisterTab risks={registerRows} />
        </TabsContent>

        <TabsContent value="sra">
          <SraTabContent
            completedAssessments={sraCompleted}
            draft={
              sraDraft
                ? {
                    id: sraDraft.id,
                    addressedCount: sraDraft.addressedCount,
                    totalCount: sraDraft.totalCount,
                  }
                : null
            }
          />
        </TabsContent>

        <TabsContent value="tech">
          <TechTabContent
            completedAssessments={taCompleted}
            draft={
              taDraft
                ? {
                    id: taDraft.id,
                    addressedCount: taDraft.addressedCount,
                    totalCount: taDraft.totalCount,
                  }
                : null
            }
          />
        </TabsContent>

        <TabsContent value="cap">
          <CapTab
            caps={caps.map((c) => ({
              id: c.id,
              description: c.description,
              status: c.status,
              dueDate: c.dueDate,
              createdAt: c.createdAt,
              ownerUserId: c.ownerUserId,
              riskItemId: c.riskItemId,
              sourceAlertId: c.sourceAlertId,
            }))}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}
