// src/app/(dashboard)/programs/allergy/page.tsx
import { redirect } from "next/navigation";
import type { Route } from "next";
import { Syringe } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { AllergyDashboard } from "./AllergyDashboard";
// Audit #21 / Allergy MIN-1: SIX_MONTHS_MS lives in src/lib/allergy/constants.ts.
// Page-level history truncation previously used 180 days, while the projection
// + competency tab used 183. Centralized constant aligns them on 183 (USP §21
// + v1 authoritative value).
import { SIX_MONTHS_MS } from "@/lib/allergy/constants";

export const metadata = { title: "Allergy · My Programs" };
export const dynamic = "force-dynamic";

export default async function AllergyProgramPage({
  searchParams,
}: {
  // Audit #21 / Allergy IM-10 (2026-04-30): admins can opt into seeing
  // soft-deleted drills via `?showRetired=1`. Default is unchanged
  // (only live drills) so the regular list stays clean.
  searchParams?: Promise<{ showRetired?: string }>;
}) {
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
    redirect("/dashboard" as Route);
  }
  // Audit #21 / Allergy IM-10: only ADMIN/OWNER can view retired drills —
  // STAFF/VIEWER ignore the query param even if a non-admin guesses it.
  const canManage = pu.role === "OWNER" || pu.role === "ADMIN";
  const sp = (await searchParams) ?? {};
  const showRetired = canManage && sp.showRetired === "1";
  // Pre-compute now-anchored values outside the Promise.all so eslint's
  // react-hooks/purity rule doesn't flag Date.now() calls inline. RSCs
  // render once per request, so a single computed timestamp is correct.
  const now = new Date();
  const year = now.getFullYear();
  const sixMonthsAgo = new Date(now.getTime() - SIX_MONTHS_MS);
  const [members, competencies, equipmentChecks, drills, retiredDrills] = await Promise.all([
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
        checkedAt: { gte: sixMonthsAgo },
        // Audit #15: hide soft-deleted rows from history reads. Retired
        // rows still live in the DB for EventLog replay + cross-tenant
        // guards but never appear in the list UI.
        retiredAt: null,
      },
      orderBy: { checkedAt: "desc" },
    }),
    db.allergyDrill.findMany({
      where: { practiceId: pu.practiceId, retiredAt: null }, // audit #15
      orderBy: { conductedAt: "desc" },
      take: 20,
    }),
    // Audit #21 / Allergy IM-10: retired drills, only when the admin
    // opted in. Skip the round-trip for everyone else.
    showRetired
      ? db.allergyDrill.findMany({
          where: { practiceId: pu.practiceId, retiredAt: { not: null } },
          orderBy: { retiredAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

  // Audit #21 (Allergy IM-2): legacy drills may carry participantIds that
  // no longer resolve to an active member of this practice (member removed,
  // or — for very old data created before the FK-integrity guard — an id
  // from another practice altogether). Fetch any "missing" ids so the UI
  // can render a "User no longer at practice" label rather than just
  // dropping them silently or saying "Unknown".
  const activeMemberIds = new Set(members.map((m) => m.id));
  const missingParticipantIds = Array.from(
    new Set(
      drills.flatMap((d) =>
        d.participantIds.filter((id) => !activeMemberIds.has(id)),
      ),
    ),
  );
  const removedParticipants = missingParticipantIds.length
    ? await db.practiceUser.findMany({
        where: { id: { in: missingParticipantIds } },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      })
    : [];

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
        canManage={canManage}
        currentPracticeUserId={pu.id}
        year={year}
        showRetiredDrills={showRetired}
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
          lastCompoundedAt: c.lastCompoundedAt?.toISOString() ?? null,
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
        retiredDrills={retiredDrills.map((d) => ({
          id: d.id,
          conductedAt: d.conductedAt.toISOString(),
          scenario: d.scenario,
          participantIds: d.participantIds,
          durationMinutes: d.durationMinutes,
          observations: d.observations,
          correctiveActions: d.correctiveActions,
          nextDrillDue: d.nextDrillDue?.toISOString() ?? null,
          retiredAt: d.retiredAt?.toISOString() ?? null,
        }))}
        legacyParticipants={removedParticipants.map((m) => ({
          id: m.id,
          name:
            [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") ||
            m.user.email ||
            "Former member",
          // True when this id belongs to a member who once existed in THIS
          // practice but has since been removed. False = id belongs to a
          // different practice entirely (legacy cross-tenant data).
          sameTenant: m.practiceId === pu.practiceId,
        }))}
      />
    </main>
  );
}
