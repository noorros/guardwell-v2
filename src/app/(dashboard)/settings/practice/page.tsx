// src/app/(dashboard)/settings/practice/page.tsx
//
// Lets OWNER/ADMIN users edit the compliance profile after onboarding.
// Reuses the same ComplianceProfileForm so questions/defaults stay in
// sync with the onboarding step.

import type { Route } from "next";
import { ClipboardList } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { ComplianceProfileForm } from "@/app/onboarding/compliance-profile/ComplianceProfileForm";

export const metadata = { title: "Practice profile · Settings" };
export const dynamic = "force-dynamic";

export default async function PracticeSettingsPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const canEdit = pu.role === "OWNER" || pu.role === "ADMIN";

  const [profile, practice] = await Promise.all([
    db.practiceComplianceProfile.findUnique({
      where: { practiceId: pu.practiceId },
    }),
    db.practice.findUnique({
      where: { id: pu.practiceId },
      select: { specialty: true, operatingStates: true, primaryState: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "Settings" }, { label: "Practice" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ClipboardList className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Practice profile
          </h1>
          <p className="text-sm text-muted-foreground">
            Toggle the operational characteristics that gate framework
            applicability. Turning a toggle off disables the matching
            framework (it disappears from the sidebar and stops counting in
            your overall score). Turning it back on restores the framework
            without re-enabling any individual requirement states.
          </p>
        </div>
      </header>

      {!canEdit ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only owners and admins can edit the practice profile.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-5 p-6">
            <ComplianceProfileForm
              initial={{
                hasInHouseLab: profile?.hasInHouseLab ?? false,
                dispensesControlledSubstances:
                  profile?.dispensesControlledSubstances ?? false,
                medicareParticipant: profile?.medicareParticipant ?? true,
                billsMedicaid: profile?.billsMedicaid ?? true,
                subjectToMacraMips: profile?.subjectToMacraMips ?? true,
                sendsAutomatedPatientMessages:
                  profile?.sendsAutomatedPatientMessages ?? true,
                compoundsAllergens: profile?.compoundsAllergens ?? false,
                specialty: practice?.specialty ?? null,
                providerCount: profile?.providerCount ?? null,
                operatingStates: practice?.operatingStates ?? [],
                primaryState: practice?.primaryState ?? "",
              }}
              redirectTo={"/settings/practice" as Route}
              submitLabel="Save profile"
            />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
