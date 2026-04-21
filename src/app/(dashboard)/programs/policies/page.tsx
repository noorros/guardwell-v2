// src/app/(dashboard)/programs/policies/page.tsx
import { FileText } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  HIPAA_POLICY_CODES,
  HIPAA_POLICY_METADATA,
  type HipaaPolicyCode,
} from "@/lib/compliance/policies";
import { PolicyActions } from "./PolicyActions";

export const metadata = { title: "Policies · My Programs" };

const DATE_FMT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export default async function PoliciesPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const rows = await db.practicePolicy.findMany({
    where: { practiceId: pu.practiceId },
    select: {
      id: true,
      policyCode: true,
      adoptedAt: true,
      retiredAt: true,
    },
  });
  const byCode = new Map(rows.map((r) => [r.policyCode, r]));

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
            Adopt the required HIPAA policies. Each adoption auto-updates the
            matching HIPAA requirements on your module page.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {HIPAA_POLICY_CODES.map((code) => {
              const meta = HIPAA_POLICY_METADATA[code as HipaaPolicyCode];
              const row = byCode.get(code);
              const isActive = row && !row.retiredAt;
              const adopted = isActive
                ? { practicePolicyId: row.id, adoptedAt: row.adoptedAt }
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
                        <Badge
                          variant="secondary"
                          className="text-[10px]"
                          style={{
                            color: "var(--gw-color-compliant)",
                            borderColor: "var(--gw-color-compliant)",
                          }}
                        >
                          Adopted {DATE_FMT.format(row.adoptedAt)}
                        </Badge>
                      ) : row?.retiredAt ? (
                        <Badge variant="outline" className="text-[10px]">
                          Retired {DATE_FMT.format(row.retiredAt)}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Not adopted
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {meta.description}
                    </p>
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
    </main>
  );
}
