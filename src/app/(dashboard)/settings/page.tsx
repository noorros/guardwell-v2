import Link from "next/link";
import type { Route } from "next";
import { Settings, Bell, CreditCard } from "lucide-react";

export const metadata = { title: "Settings · GuardWell" };

const SECTIONS = [
  {
    href: "/settings/practice",
    icon: Settings,
    title: "Practice profile",
    description: "Identity, location, NPI, specialty, and EHR.",
  },
  {
    href: "/settings/notifications",
    icon: Bell,
    title: "Notifications",
    description: "Daily and weekly digest preferences.",
  },
  {
    href: "/settings/subscription",
    icon: CreditCard,
    title: "Subscription",
    description: "Plan, billing, and payment method.",
  },
] as const;

export default function SettingsIndexPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map(({ href, icon: Icon, title, description }) => (
          <li key={href}>
            <Link
              href={href as Route}
              className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-start gap-3">
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold">{title}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
