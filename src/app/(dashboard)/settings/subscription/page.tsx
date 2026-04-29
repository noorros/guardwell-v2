import { redirect } from "next/navigation";
import type { Route } from "next";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { SubscriptionPanel } from "@/components/gw/SubscriptionPanel";
import type { SubscriptionStatus } from "@/components/gw/SubscriptionPanel";

export const metadata = { title: "Subscription · Settings · GuardWell" };
export const dynamic = "force-dynamic";

async function fetchCardLast4(stripeCustomerId: string | null): Promise<string | null> {
  if (!stripeCustomerId) return null;
  try {
    const customer = await getStripe().customers.retrieve(stripeCustomerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return null;
    const dpm = customer.invoice_settings?.default_payment_method;
    if (typeof dpm === "string" || !dpm) return null;
    return dpm.card?.last4 ?? null;
  } catch {
    return null;
  }
}

export default async function SubscriptionPage() {
  const pu = await getPracticeUser();
  if (!pu) redirect("/sign-in" as Route);

  const practice = await db.practice.findUniqueOrThrow({
    where: { id: pu.practiceId },
    select: {
      subscriptionStatus: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      stripeCustomerId: true,
    },
  });

  const cardLast4 = await fetchCardLast4(practice.stripeCustomerId);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Subscription</h1>
      <SubscriptionPanel
        subscriptionStatus={practice.subscriptionStatus as SubscriptionStatus}
        currentPeriodEnd={practice.currentPeriodEnd}
        trialEndsAt={practice.trialEndsAt}
        stripeCustomerId={practice.stripeCustomerId}
        cardLast4={cardLast4}
        planLabel="GuardWell · $249/mo"
      />
    </main>
  );
}
