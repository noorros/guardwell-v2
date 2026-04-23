// src/app/(dashboard)/programs/incidents/new/page.tsx
import type { Route } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { IncidentReportForm } from "./IncidentReportForm";

export const metadata = { title: "Report incident · My Programs" };

export default async function NewIncidentPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Breadcrumb
        items={[
          { label: "My Programs" },
          { label: "Incidents", href: "/programs/incidents" as Route },
          { label: "Report" },
        ]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Report incident</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture the facts now. The HIPAA four-factor breach determination
            runs separately from the incident detail page once you&apos;ve
            entered the essentials.
          </p>
        </div>
        <Link
          href={"/programs/incidents" as Route}
          className="text-xs text-muted-foreground hover:underline"
        >
          Cancel
        </Link>
      </header>

      <IncidentReportForm
        primaryState={pu.practice.primaryState}
        operatingStates={pu.practice.operatingStates}
      />
    </main>
  );
}
