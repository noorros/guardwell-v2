// src/components/gw/AppShell/UserMenu.tsx
//
// Avatar/initials dropdown shown in the upper-right of the dashboard TopBar.
// Replaces the prior plain-text email + Sign-out button. Menu items deep-link
// to the four settings sub-pages (Practice profile, Notifications, Subscription)
// plus the Sign-out action. Email + practice name appear in the menu header.
"use client";

import Link from "next/link";
import type { Route } from "next";
import { LogOut } from "lucide-react";
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

export interface UserMenuProps {
  userEmail: string;
  practiceName: string;
  userInitials: string;
}

export function UserMenu({ userEmail, practiceName, userInitials }: UserMenuProps) {
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
