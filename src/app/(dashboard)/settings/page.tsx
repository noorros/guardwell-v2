import Link from "next/link";
import type { Route } from "next";
import { Settings, Bell, CreditCard, Clock } from "lucide-react";
import { getPracticeUser } from "@/lib/rbac";

export const metadata = { title: "Settings · GuardWell" };
export const dynamic = "force-dynamic";

interface Section {
  href: Route;
  icon: typeof Settings;
  title: string;
  description: string;
  /** When true, only OWNER + ADMIN see this tile. Default = visible to all. */
  adminOnly?: boolean;
}

const SECTIONS: Section[] = [
  {
    href: "/settings/practice" as Route,
    icon: Settings,
    title: "Practice profile",
    description: "Identity, location, NPI, specialty, and EHR.",
  },
  {
    href: "/settings/notifications" as Route,
    icon: Bell,
    title: "Notifications",
    description: "Daily and weekly digest preferences.",
  },
  {
    href: "/settings/reminders" as Route,
    icon: Clock,
    title: "Reminders",
    description: "When GuardWell starts nudging before deadlines.",
    adminOnly: true,
  },
  {
    href: "/settings/subscription" as Route,
    icon: CreditCard,
    title: "Subscription",
    description: "Plan, billing, and payment method.",
  },
];

export default async function SettingsIndexPage() {
  const pu = await getPracticeUser();
  const isAdmin =
    pu !== null && (pu.role === "OWNER" || pu.role === "ADMIN");
  const visible = SECTIONS.filter((s) => !s.adminOnly || isAdmin);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {visible.map(({ href, icon: Icon, title, description }) => (
          <li key={href}>
            <Link
              href={href}
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
