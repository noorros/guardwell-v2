// src/app/onboarding/compliance-profile/page.tsx
//
// Step 2 of the onboarding wizard. Lives outside (dashboard) because
// the dashboard layout redirects users without a PracticeUser; this
// page assumes a PracticeUser exists but the practice may not yet
// have a compliance profile.

import { redirect } from "next/navigation";
import type { Route } from "next";
import { ClipboardList } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { ComplianceProfileForm } from "./ComplianceProfileForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compliance profile · Onboarding" };

export default async function CompliancePreofilePage() {
  const pu = await getPracticeUser();
  if (!pu) redirect("/onboarding/create-practice" as Route);

  const existing = await db.practiceComplianceProfile.findUnique({
    where: { practiceId: pu.practiceId },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-start p-6">
      <Card className="w-full">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <ClipboardList className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="flex-1 space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">
                Tell us about {pu.practice.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                A few quick questions so GuardWell can tailor which
                frameworks show in your sidebar. You can change any answer
                later in Settings.
              </p>
            </div>
          </div>
          <ComplianceProfileForm
            initial={{
              hasInHouseLab: existing?.hasInHouseLab ?? false,
              dispensesControlledSubstances:
                existing?.dispensesControlledSubstances ?? false,
              medicareParticipant: existing?.medicareParticipant ?? true,
              billsMedicaid: existing?.billsMedicaid ?? true,
              subjectToMacraMips: existing?.subjectToMacraMips ?? true,
              sendsAutomatedPatientMessages:
                existing?.sendsAutomatedPatientMessages ?? true,
              specialtyCategory: existing?.specialtyCategory ?? null,
              providerCount: existing?.providerCount ?? null,
            }}
            redirectTo={"/onboarding/first-run" as Route}
            submitLabel="Continue → First-run setup"
          />
        </CardContent>
      </Card>
    </main>
  );
}
