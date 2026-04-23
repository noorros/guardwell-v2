// src/components/gw/AppShell/AppShell.tsx
import type { ReactNode } from "react";
import { Sidebar, type MyComplianceItem } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileSidebarTrigger } from "./MobileSidebarTrigger";
import type { NotificationBellItem } from "./NotificationBell";

export interface AppShellProps {
  children: ReactNode;
  practice: { name: string };
  user: { email: string };
  myComplianceItems: MyComplianceItem[];
  notifications?: {
    unreadCount: number;
    recent: NotificationBellItem[];
  };
}

/**
 * The signed-in app frame: fixed top bar + left sidebar on desktop, collapsed
 * sidebar behind a hamburger on mobile. Children render in the scrollable
 * main area.
 *
 * Keeps a <main id="main"> landmark so the root layout's skip-to-main link
 * (see src/app/layout.tsx) continues to focus page content, not chrome.
 */
export function AppShell({
  children,
  practice,
  user,
  myComplianceItems,
  notifications,
}: AppShellProps) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar
        practiceName={practice.name}
        userEmail={user.email}
        mobileTrigger={
          <MobileSidebarTrigger myComplianceItems={myComplianceItems} />
        }
        notifications={notifications}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 overflow-y-auto md:block">
          <Sidebar myComplianceItems={myComplianceItems} />
        </aside>
        <main
          id="main"
          className="min-w-0 flex-1 overflow-y-auto bg-background"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
