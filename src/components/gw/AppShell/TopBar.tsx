// src/components/gw/AppShell/TopBar.tsx
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/(auth)/sign-out/actions";
import { cn } from "@/lib/utils";
import {
  NotificationBell,
  type NotificationBellItem,
} from "./NotificationBell";

export interface TopBarProps {
  practiceName: string;
  userEmail: string;
  mobileTrigger?: ReactNode;
  notifications?: {
    unreadCount: number;
    recent: NotificationBellItem[];
  };
  className?: string;
}

export function TopBar({
  practiceName,
  userEmail,
  mobileTrigger,
  notifications,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        "flex h-14 items-center gap-3 border-b bg-card px-4",
        className,
      )}
    >
      {mobileTrigger}
      <span className="truncate font-semibold text-foreground">{practiceName}</span>
      <div className="ml-auto flex items-center gap-3">
        {notifications && (
          <NotificationBell
            unreadCount={notifications.unreadCount}
            recent={notifications.recent}
          />
        )}
        <span className="hidden truncate text-sm text-muted-foreground sm:inline">
          {userEmail}
        </span>
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Sign out</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
