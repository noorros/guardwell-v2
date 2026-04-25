import { redirect } from "next/navigation";
import type { Route } from "next";
import { getCurrentUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";

export default async function FirstRunLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-up" as Route);
  if (!user.emailVerified) redirect("/sign-up/verify" as Route);

  const pu = await getPracticeUser();
  if (!pu) redirect("/onboarding/create-practice" as Route);

  // Subscription gate — only TRIALING/ACTIVE can be in the wizard.
  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: { subscriptionStatus: true, firstRunCompletedAt: true },
  });
  if (practice.subscriptionStatus === "INCOMPLETE") {
    redirect("/sign-up/payment" as Route);
  }
  if (
    practice.subscriptionStatus === "PAST_DUE" ||
    practice.subscriptionStatus === "CANCELED"
  ) {
    redirect("/account/locked" as Route);
  }

  // Compliance profile gate — wizard assumes it's done.
  const profile = await db.practiceComplianceProfile.findUnique({
    where: { practiceId: pu.practiceId },
    select: { practiceId: true },
  });
  if (!profile) redirect("/onboarding/compliance-profile" as Route);

  // If the wizard's already finished, send them home.
  if (practice.firstRunCompletedAt) redirect("/dashboard" as Route);

  return <div className="min-h-screen bg-background">{children}</div>;
}
