// src/app/(dashboard)/programs/allergy/page.tsx
import { redirect } from "next/navigation";
import type { Route } from "next";
import { Syringe } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { AllergyDashboard } from "./AllergyDashboard";

export const metadata = { title: "Allergy · My Programs" };
export const dynamic = "force-dynamic";

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

export default async function AllergyProgramPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const framework = await db.practiceFramework.findFirst({
    where: {
      practiceId: pu.practiceId,
      enabled: true,
      framework: { code: "ALLERGY" },
    },
  });
  if (!framework) {
    redirect("/programs" as Route);
  }
  const year = new Date().getFullYear();
  const [members, competencies, equipmentChecks, drills] = await Promise.all([
    db.practiceUser.findMany({
      where: { practiceId: pu.practiceId, removedAt: null },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ requiresAllergyCompetency: "desc" }, { joinedAt: "asc" }],
    }),
    db.allergyCompetency.findMany({
      where: { practiceId: pu.practiceId, year },
    }),
    db.allergyEquipmentCheck.findMany({
      where: {
        practiceId: pu.practiceId,
        checkedAt: { gte: new Date(Date.now() - SIX_MONTHS_MS) },
      },
      orderBy: { checkedAt: "desc" },
    }),
    db.allergyDrill.findMany({
      where: { practiceId: pu.practiceId },
      orderBy: { conductedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "Allergy" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Syringe className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Allergy / USP 797 §21
          </h1>
          <p className="text-sm text-muted-foreground">
            Annual 3-component competency for every compounder, monthly equipment + fridge logs, and anaphylaxis drills. Drives the ALLERGY module score.
          </p>
        </div>
      </header>
      <AllergyDashboard
        canManage={pu.role === "OWNER" || pu.role === "ADMIN"}
        currentPracticeUserId={pu.id}
        year={year}
        members={members.map((m) => ({
          id: m.id,
          role: m.role,
          requiresAllergyCompetency: m.requiresAllergyCompetency,
          name: [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || m.user.email || "Unknown",
          email: m.user.email,
        }))}
        competencies={competencies.map((c) => ({
          id: c.id,
          practiceUserId: c.practiceUserId,
          year: c.year,
          quizPassedAt: c.quizPassedAt?.toISOString() ?? null,
          fingertipPassCount: c.fingertipPassCount,
          fingertipLastPassedAt: c.fingertipLastPassedAt?.toISOString() ?? null,
          mediaFillPassedAt: c.mediaFillPassedAt?.toISOString() ?? null,
          isFullyQualified: c.isFullyQualified,
        }))}
        equipmentChecks={equipmentChecks.map((e) => ({
          id: e.id,
          checkType: e.checkType,
          checkedAt: e.checkedAt.toISOString(),
          epiExpiryDate: e.epiExpiryDate?.toISOString() ?? null,
          epiLotNumber: e.epiLotNumber ?? null,
          allItemsPresent: e.allItemsPresent,
          itemsReplaced: e.itemsReplaced ?? null,
          temperatureC: e.temperatureC,
          inRange: e.inRange,
          notes: e.notes,
        }))}
        drills={drills.map((d) => ({
          id: d.id,
          conductedAt: d.conductedAt.toISOString(),
          scenario: d.scenario,
          participantIds: d.participantIds,
          durationMinutes: d.durationMinutes,
          observations: d.observations,
          correctiveActions: d.correctiveActions,
          nextDrillDue: d.nextDrillDue?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
