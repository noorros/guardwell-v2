// src/components/gw/AppShell/TopBar.tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  NotificationBell,
  type NotificationBellItem,
} from "./NotificationBell";
import { UserMenu, type UserMenuMembership } from "./UserMenu";

export interface TopBarProps {
  practiceName: string;
  userEmail: string;
  userInitials: string;
  memberships: UserMenuMembership[];
  currentPracticeId: string;
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
  userInitials,
  memberships,
  currentPracticeId,
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
        <UserMenu
          userEmail={userEmail}
          practiceName={practiceName}
          userInitials={userInitials}
          memberships={memberships}
          currentPracticeId={currentPracticeId}
        />
      </div>
    </header>
  );
}
