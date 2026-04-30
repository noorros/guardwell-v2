// src/app/(dashboard)/settings/practice/page.tsx
//
// Lets OWNER/ADMIN users edit the full Practice profile (Identity /
// Location / Practice). Renders the unified PracticeProfileForm in
// "settings" mode, which surfaces staffHeadcount + phone in addition
// to the compliance-relevant fields shared with onboarding.

import type { Route } from "next";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { PracticeProfileForm } from "@/components/gw/PracticeProfileForm";
import type { PracticeProfileInput } from "@/components/gw/PracticeProfileForm/types";
import { savePracticeProfileAction } from "./actions";

export const metadata = { title: "Practice profile · Settings · GuardWell" };
export const dynamic = "force-dynamic";

export default async function PracticeSettingsPage() {
  const pu = await getPracticeUser();
  if (!pu) redirect("/sign-in" as Route);

  const canEdit = pu.role === "OWNER" || pu.role === "ADMIN";

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
  });

  const initial: PracticeProfileInput = {
    name: practice.name,
    npiNumber: practice.npiNumber,
    entityType:
      (practice.entityType as "COVERED_ENTITY" | "BUSINESS_ASSOCIATE") ??
      "COVERED_ENTITY",
    primaryState: practice.primaryState,
    operatingStates: practice.operatingStates ?? [],
    timezone: practice.timezone,
    addressStreet: practice.addressStreet,
    addressSuite: practice.addressSuite,
    addressCity: practice.addressCity,
    addressZip: practice.addressZip,
    specialty: practice.specialty,
    providerCount:
      (practice.providerCount as PracticeProfileInput["providerCount"]) ??
      "SOLO",
    ehrSystem: practice.ehrSystem,
    staffHeadcount: practice.staffHeadcount,
    phone: practice.phone,
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
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
            Edit your practice details. Changes appear in compliance reports
            immediately.
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
            <PracticeProfileForm
              mode="settings"
              initial={initial}
              onSubmit={savePracticeProfileAction}
            />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
