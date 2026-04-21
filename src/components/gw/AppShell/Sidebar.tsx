// src/components/gw/AppShell/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import {
  ShieldCheck,
  Users,
  FileText,
  GraduationCap,
  AlertTriangle,
  IdCard,
  Building2,
  ShieldAlert,
  LayoutDashboard,
  ScrollText,
  FileBarChart2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, scoreToColorToken } from "@/lib/utils";

/**
 * A single regulatory framework the practice has enabled. Used to render one
 * nav row per framework in the "My Compliance" section of the sidebar.
 */
export interface MyComplianceItem {
  /** Framework code — used to build /modules/<code> hrefs (lowercased). */
  code: string;
  /** Full framework name (e.g. "HIPAA Privacy Rule"). Fallback when shortName is missing. */
  name: string;
  /** Preferred short label (e.g. "HIPAA"). Shown in the sidebar when set. */
  shortName?: string | null;
  /** Cached compliance score 0-100 for the mini indicator. */
  score: number;
}

export interface SidebarProps {
  myComplianceItems: MyComplianceItem[];
  /**
   * Called after a nav click. The responsive wrapper passes a handler that
   * closes the mobile sheet; the desktop sidebar omits it.
   */
  onNavigate?: () => void;
  className?: string;
}

interface ProgramItem {
  label: string;
  icon: LucideIcon;
  /**
   * When set, the item becomes a live link. When omitted, it renders as a
   * disabled "Soon" row. Kept optional so the seven programs can light up
   * one at a time as each gets its own page.
   */
  href?: Route;
}

const PROGRAMS: ProgramItem[] = [
  // Cast to Route — Next.js's typed-routes manifest only lists a path
  // after a build. The /programs/staff route is new in this PR and will
  // be picked up on the first `next build`, but tsc standalone doesn't
  // know about it yet.
  { label: "Staff", icon: Users, href: "/programs/staff" as Route },
  { label: "Policies", icon: FileText, href: "/programs/policies" as Route },
  { label: "Training", icon: GraduationCap },
  { label: "Incidents", icon: AlertTriangle },
  { label: "Credentials", icon: IdCard },
  { label: "Vendors", icon: Building2 },
  { label: "Risk", icon: ShieldAlert },
];

const AUDIT_ITEMS: ProgramItem[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Activity log", icon: ScrollText },
  { label: "Reports", icon: FileBarChart2 },
];

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function SoonBadge() {
  return (
    <Badge
      variant="secondary"
      className="ml-auto px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
    >
      Soon
    </Badge>
  );
}

function ScoreDot({ score }: { score: number }) {
  return (
    <span
      data-slot="score-dot"
      aria-hidden="true"
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: scoreToColorToken(score) }}
    />
  );
}

function ComingSoonItem({ icon: Icon, label }: ProgramItem) {
  return (
    <div
      aria-disabled="true"
      className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
      <SoonBadge />
    </div>
  );
}

function ProgramLink({
  icon: Icon,
  label,
  href,
  onNavigate,
  isActive,
}: {
  icon: LucideIcon;
  label: string;
  href: Route;
  onNavigate?: () => void;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
        isActive
          ? "bg-accent font-semibold text-accent-foreground"
          : "text-foreground/80",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function Sidebar({
  myComplianceItems,
  onNavigate,
  className,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex h-full w-full flex-col gap-1 border-r bg-card p-2",
        className,
      )}
    >
      <SectionHeader>My Compliance</SectionHeader>
      {myComplianceItems.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No frameworks enabled yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {myComplianceItems.map((item) => {
            const href = `/modules/${item.code.toLowerCase()}` as Route;
            const isActive = pathname === href;
            const label = item.shortName?.trim() || item.name;
            return (
              <li key={item.code}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
                    isActive
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "text-foreground/80",
                  )}
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                  <span className="ml-auto flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                    <ScoreDot score={item.score} />
                    <span>{item.score}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <SectionHeader>My Programs</SectionHeader>
      <ul className="flex flex-col gap-0.5">
        {PROGRAMS.map((p) => (
          <li key={p.label}>
            {p.href ? (
              <ProgramLink
                icon={p.icon}
                label={p.label}
                href={p.href}
                onNavigate={onNavigate}
                isActive={pathname === p.href}
              />
            ) : (
              <ComingSoonItem {...p} />
            )}
          </li>
        ))}
      </ul>

      <SectionHeader>Audit &amp; Insights</SectionHeader>
      <ul className="flex flex-col gap-0.5">
        {AUDIT_ITEMS.map((p) => (
          <li key={p.label}>
            <ComingSoonItem {...p} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
