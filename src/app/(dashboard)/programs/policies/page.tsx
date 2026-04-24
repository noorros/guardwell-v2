// src/app/(dashboard)/programs/policies/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { FileText, Library } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ALL_POLICY_CODES,
  POLICY_METADATA,
} from "@/lib/compliance/policies";
import { PolicyActions } from "./PolicyActions";
import { AdoptedBadge, RetiredBadge } from "./AdoptedBadge";
import { TemplateAdoptButton } from "./TemplateAdoptButton";

export const metadata = { title: "Policies · My Programs" };
export const dynamic = "force-dynamic";

const TEMPLATE_FRAMEWORK_FILTERS = ["ALL", "HIPAA", "OSHA", "GENERAL", "DEA"];

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams?: Promise<{ tpl_fw?: string; tpl_q?: string }>;
}) {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const sp = (await searchParams) ?? {};
  const tplFw =
    sp.tpl_fw && TEMPLATE_FRAMEWORK_FILTERS.includes(sp.tpl_fw)
      ? sp.tpl_fw
      : "ALL";
  const tplQ = sp.tpl_q?.trim() ?? "";

  const rows = await db.practicePolicy.findMany({
    where: { practiceId: pu.practiceId },
    select: {
      id: true,
      policyCode: true,
      adoptedAt: true,
      lastReviewedAt: true,
      retiredAt: true,
    },
  });
  const byCode = new Map(rows.map((r) => [r.policyCode, r]));

  // Group policies by framework so users see HIPAA and OSHA sections
  // distinctly. Ordered by ALL_POLICY_CODES (HIPAA first, then OSHA).
  const byFramework = new Map<string, typeof ALL_POLICY_CODES>();
  for (const code of ALL_POLICY_CODES) {
    const fw = POLICY_METADATA[code].framework;
    if (!byFramework.has(fw)) byFramework.set(fw, []);
    (byFramework.get(fw) as unknown as string[]).push(code);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "Policies" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <FileText className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Policies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Adopt the required policies for each framework your practice is
            enabled for. Each adoption auto-updates the matching requirements
            on your module page.
          </p>
        </div>
      </header>

      <h2 className="text-base font-semibold text-foreground">
        Required policies
      </h2>
      {Array.from(byFramework.entries()).map(([framework, codes]) => (
        <Card key={framework}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {framework}
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {codes.length} polic{codes.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <ul className="divide-y">
              {codes.map((code) => {
                const meta = POLICY_METADATA[code];
                const row = byCode.get(code);
                const isActive = row && !row.retiredAt;
                const adopted = isActive
                  ? {
                      practicePolicyId: row.id,
                      adoptedAt: row.adoptedAt,
                      lastReviewedAt:
                        row.lastReviewedAt?.toISOString() ?? null,
                    }
                  : null;
                // Review-status surfacing: when adopted + a 365-day
                // review window applies, show how many days until/since
                // the next required review.
                const REVIEW_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
                const reviewDaysOut =
                  isActive && row.lastReviewedAt
                    ? Math.ceil(
                        (row.lastReviewedAt.getTime() +
                          REVIEW_WINDOW_MS -
                          Date.now()) /
                          (24 * 60 * 60 * 1000),
                      )
                    : null;

                return (
                  <li
                    key={code}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {meta.title}
                        </p>
                        {isActive ? (
                          <AdoptedBadge adoptedAt={row.adoptedAt.toISOString()} />
                        ) : row?.retiredAt ? (
                          <RetiredBadge retiredAt={row.retiredAt.toISOString()} />
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            Not adopted
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {meta.description}
                      </p>
                      {isActive && reviewDaysOut !== null && (
                        <p
                          className="text-[11px]"
                          style={{
                            color:
                              reviewDaysOut < 0
                                ? "var(--gw-color-risk)"
                                : reviewDaysOut <= 60
                                  ? "var(--gw-color-needs)"
                                  : "var(--gw-color-compliant)",
                          }}
                        >
                          {reviewDaysOut < 0
                            ? `Review overdue by ${Math.abs(reviewDaysOut)} day${Math.abs(reviewDaysOut) === 1 ? "" : "s"}`
                            : reviewDaysOut === 0
                              ? "Review due today"
                              : `Next review in ${reviewDaysOut} day${reviewDaysOut === 1 ? "" : "s"}`}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <PolicyActions policyCode={code} adopted={adopted} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}

      {/* Template library — additional 130-template catalog ported from
          v1. Templates outside the required-policy set above don't
          satisfy any module requirement on their own; they live in the
          practice's adopted-policies shelf for reference + audit
          coverage. */}
      <TemplateLibrarySection
        practiceId={pu.practiceId}
        practiceState={pu.practice.primaryState}
        currentFilter={tplFw}
        currentQuery={tplQ}
      />
    </main>
  );
}

interface TemplateLibrarySectionProps {
  practiceId: string;
  practiceState: string;
  currentFilter: string;
  currentQuery: string;
}

async function TemplateLibrarySection({
  practiceId,
  practiceState,
  currentFilter,
  currentQuery,
}: TemplateLibrarySectionProps) {
  // Filter templates by framework + search query + state applicability.
  const where: {
    framework?: string;
    OR?: Array<Record<string, unknown>>;
    AND?: Array<Record<string, unknown>>;
  } = {};
  if (currentFilter !== "ALL") where.framework = currentFilter;
  if (currentQuery) {
    where.OR = [
      { title: { contains: currentQuery, mode: "insensitive" } },
      { description: { contains: currentQuery, mode: "insensitive" } },
      { code: { contains: currentQuery, mode: "insensitive" } },
    ];
  }
  // State filter: only show universal (stateFilter null) OR matching practice state.
  where.AND = [
    {
      OR: [{ stateFilter: null }, { stateFilter: practiceState }],
    },
  ];

  const allTemplates = await db.policyTemplate.findMany({
    where,
    orderBy: [{ framework: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
    take: 200, // safety cap; we expect ~130 max
  });

  // Existing adoptions to mark "Adopted" badge inline.
  const existing = await db.practicePolicy.findMany({
    where: { practiceId, retiredAt: null },
    select: { policyCode: true },
  });
  const adoptedCodes = new Set(existing.map((p) => p.policyCode));

  // Counts per framework for the filter chips (always show the unfiltered
  // total — feels weird to have the chip show "0" when it switches the
  // user's view away).
  const allCounts = await db.policyTemplate.groupBy({
    by: ["framework"],
    _count: true,
    where: {
      OR: [{ stateFilter: null }, { stateFilter: practiceState }],
    },
  });
  const totalAll = allCounts.reduce((acc, c) => acc + c._count, 0);
  const countByFw = new Map(allCounts.map((c) => [c.framework, c._count]));

  const filterLabel = (key: string): string => {
    if (key === "ALL") return `All (${totalAll})`;
    return `${key} (${countByFw.get(key) ?? 0})`;
  };

  return (
    <>
      <h2 className="text-base font-semibold text-foreground">
        Template library
      </h2>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <Library
              className="mt-0.5 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold">
                {totalAll} adoptable templates available for {practiceState}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Browseable catalog ported from v1. Adopting a template
                copies its body into a new PracticePolicy you can edit.
                Templates outside the required-policy set above expand
                your policy library without changing module scoring.
              </p>
            </div>
          </div>
          <form
            method="GET"
            action="/programs/policies"
            className="flex flex-wrap items-end gap-2"
          >
            <label className="flex-1 space-y-1 text-xs font-medium text-foreground">
              Search
              <input
                type="text"
                name="tpl_q"
                defaultValue={currentQuery}
                placeholder="e.g. encryption, sanctions, sharps"
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-foreground">
              Framework
              <select
                name="tpl_fw"
                defaultValue={currentFilter}
                className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {TEMPLATE_FRAMEWORK_FILTERS.map((f) => (
                  <option key={f} value={f}>
                    {filterLabel(f)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Apply
            </button>
            {(currentFilter !== "ALL" || currentQuery) && (
              <Link
                href={"/programs/policies" as Route}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                Clear
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Showing {allTemplates.length} template
              {allTemplates.length === 1 ? "" : "s"}
            </h3>
          </div>
          {allTemplates.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No templates match these filters.
            </div>
          ) : (
            <ul className="divide-y">
              {allTemplates.map((t) => {
                const adopted = adoptedCodes.has(t.code);
                return (
                  <li
                    key={t.id}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {t.title}
                        </p>
                        <Badge variant="secondary" className="text-[10px]">
                          {t.framework}
                        </Badge>
                        {t.stateFilter && (
                          <Badge variant="outline" className="text-[10px]">
                            {t.stateFilter}
                          </Badge>
                        )}
                        {t.specialtyFilter && (
                          <Badge variant="outline" className="text-[10px]">
                            {t.specialtyFilter.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">
                        {t.description}
                      </p>
                    </div>
                    <TemplateAdoptButton
                      templateCode={t.code}
                      alreadyAdopted={adopted}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
