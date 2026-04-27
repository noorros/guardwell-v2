// src/app/(dashboard)/audit/reports/page.tsx
//
// Reports surface — list of generators. Each row downloads a fresh PDF
// reflecting current data. More reports (BAA roster, credentials list)
// in follow-up PRs.

import {
  FileBarChart2,
  FileDown,
  GraduationCap,
  AlertTriangle,
  Building2,
  IdCard,
  ShieldCheck,
} from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Reports · Audit" };

interface ReportEntry {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: typeof FileDown;
}

const REPORTS: ReportEntry[] = [
  {
    id: "compliance-snapshot",
    title: "Compliance snapshot (PDF)",
    description:
      "Three-page executive summary: overall score, framework breakdown, critical gaps, SRA status, and recent incidents. Respects the practice's jurisdictions.",
    href: "/api/audit/compliance-report",
    icon: FileDown,
  },
  {
    id: "training-summary",
    title: "Training summary (PDF)",
    description:
      "Per-staff completion grid bucketed by expired / expiring within 60 days / current. Use for OSHA review or HR audits.",
    href: "/api/audit/training-summary",
    icon: GraduationCap,
  },
  {
    id: "incident-summary",
    title: "Incident summary (PDF)",
    description:
      "All incidents grouped by status (open/under-investigation/resolved/closed) with breach determinations + affected counts. Use for HHS OCR audit response.",
    href: "/api/audit/incident-summary",
    icon: AlertTriangle,
  },
  {
    id: "vendor-baa-register",
    title: "Vendor + BAA register (PDF)",
    description:
      "Every active vendor with service description + BAA execution + expiry status. Splits PHI vs non-PHI vendors. Required for HIPAA §164.502(e) BA contracts evidence.",
    href: "/api/audit/vendor-baa-register",
    icon: Building2,
  },
  {
    id: "credentials-register",
    title: "Credentials register (PDF)",
    description:
      "License, DEA, malpractice, and other credentials grouped by holder with expiration warnings. Use for state board renewals, malpractice insurance, CMS site visits.",
    href: "/api/audit/credentials-register",
    icon: IdCard,
  },
  {
    id: "pp-attestation",
    title: "Annual P&P review attestation (PDF)",
    description:
      "List of every adopted policy with version + last review date, plus a Privacy Officer signature block. Required for HIPAA §164.530(i)(2) annual policy review.",
    href: "/api/audit/pp-attestation",
    icon: ShieldCheck,
  },
];

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

      {REPORTS.map((report) => {
        const Icon = report.icon;
        return (
          <Card key={report.id}>
            <CardContent className="flex items-start gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-sm font-semibold">{report.title}</h2>
                <p className="text-xs text-muted-foreground">
                  {report.description}
                </p>
                <a
                  href={report.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  Download PDF
                </a>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </main>
  );
}
