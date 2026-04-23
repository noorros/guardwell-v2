// src/app/(dashboard)/programs/policies/page.tsx
import { FileText } from "lucide-react";
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

export const metadata = { title: "Policies · My Programs" };

export default async function PoliciesPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

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
    </main>
  );
}
