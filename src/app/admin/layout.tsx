// src/app/admin/layout.tsx
//
// Internal admin surface — gated by User.isPlatformAdmin. Lives at
// /admin/* and is intentionally NOT under (dashboard) so it doesn't
// inherit the customer-facing AppShell.

import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Admin — GuardWell",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requirePlatformAdmin();
  } catch {
    redirect("/sign-in" as Route);
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <Link
            href={"/admin" as Route}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <ShieldCheck className="h-4 w-4 text-[color:var(--gw-color-risk)]" aria-hidden="true" />
            GuardWell Admin
          </Link>
          <nav className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link href={"/admin" as Route} className="hover:text-foreground">
              Dashboard
            </Link>
            <Link
              href={"/admin/practices" as Route}
              className="hover:text-foreground"
            >
              Practices
            </Link>
          </nav>
          <span className="ml-auto rounded bg-[color:var(--gw-color-risk)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[color:var(--gw-color-risk)]">
            Internal
          </span>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
