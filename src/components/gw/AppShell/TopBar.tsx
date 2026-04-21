// src/components/gw/AppShell/TopBar.tsx
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/(auth)/sign-out/actions";
import { cn } from "@/lib/utils";

export interface TopBarProps {
  practiceName: string;
  userEmail: string;
  /**
   * Optional hamburger trigger rendered on the left for viewports that hide
   * the sidebar. Kept as a slot so the TopBar stays a server component and
   * the responsive trigger (which owns a Sheet state) can be a client island.
   */
  mobileTrigger?: ReactNode;
  className?: string;
}

export function TopBar({
  practiceName,
  userEmail,
  mobileTrigger,
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
