// src/components/gw/AppShell/UserMenu.tsx
//
// Avatar/initials dropdown shown in the upper-right of the dashboard TopBar.
// Replaces the prior plain-text email + Sign-out button. Menu items deep-link
// to the four settings sub-pages (Practice profile, Notifications, Subscription)
// plus the Sign-out action. Email + practice name appear in the menu header.
//
// Audit #7 (HIPAA B-3): when the user has 2+ practice memberships, a
// "Switch practice" section renders above the settings links — each
// practice is a `<form>` POST to switchPracticeAction so a tampered
// client can't escalate to a practice they don't belong to.
"use client";

import Link from "next/link";
import type { Route } from "next";
import { Check, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/app/(auth)/sign-out/actions";
import { switchPracticeAction } from "@/app/(dashboard)/settings/switch-practice/actions";

export interface UserMenuMembership {
  practiceId: string;
  practiceName: string;
  role: string;
}

export interface UserMenuProps {
  userEmail: string;
  practiceName: string;
  userInitials: string;
  memberships: UserMenuMembership[];
  currentPracticeId: string;
}

export function UserMenu({
  userEmail,
  practiceName,
  userInitials,
  memberships,
  currentPracticeId,
}: UserMenuProps) {
  const showSwitcher = memberships.length > 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open user menu"
          className="h-8 w-8 rounded-full bg-secondary p-0 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80"
        >
          {userInitials}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{userEmail}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {practiceName}
          </span>
        </DropdownMenuLabel>
        {showSwitcher && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Switch practice
            </DropdownMenuLabel>
            {memberships.map((m) => {
              const isCurrent = m.practiceId === currentPracticeId;
              return (
                <form key={m.practiceId} action={switchPracticeAction}>
                  <input type="hidden" name="practiceId" value={m.practiceId} />
                  <button
                    type="submit"
                    disabled={isCurrent}
                    aria-current={isCurrent ? "true" : undefined}
                    className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent disabled:cursor-default disabled:bg-transparent"
                  >
                    <span className="flex flex-col gap-0.5 text-left">
                      <span className="truncate font-medium">{m.practiceName}</span>
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {m.role}
                      </span>
                    </span>
                    {isCurrent && (
                      <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    )}
                  </button>
                </form>
              );
            })}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={"/settings/practice" as Route}>Practice profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={"/settings/notifications" as Route}>Notifications</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={"/settings/subscription" as Route}>Subscription</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
