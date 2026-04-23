// src/app/(dashboard)/audit/reports/page.tsx
//
// Reports surface — currently just the compliance-snapshot PDF. Additional
// reports (training transcript, incident ledger, BAA roster) will land here
// as separate entries in follow-up PRs.

import { FileBarChart2, FileDown } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Reports · Audit" };

export default async function AuditReportsPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "Audit & Insights" }, { label: "Reports" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <FileBarChart2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Printable snapshots of compliance state — use for audit response
            packets, board reviews, or outside-counsel reviews. Each download
            reflects the latest data at the time of generation.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="flex items-start gap-4 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <FileDown className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-sm font-semibold">Compliance snapshot (PDF)</h2>
            <p className="text-xs text-muted-foreground">
              Three-page executive summary: overall score, framework
              breakdown, critical gaps, SRA status, and recent incidents.
              Respects the practice&apos;s jurisdictions.
            </p>
            <a
              href="/api/audit/compliance-report"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Download PDF
            </a>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
