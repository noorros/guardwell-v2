// src/components/gw/ConciergeConversation/MobileThreadSwitcher.tsx
"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ThreadList, type ThreadRow } from "./ThreadList";

export interface MobileThreadSwitcherProps {
  threads: ThreadRow[];
  activeThreadId: string | null;
  showArchived: boolean;
}

/**
 * Hamburger shown on < md viewports on /concierge. Opens a left-side Sheet
 * containing the ThreadList. Replaces the prior <details> placeholder.
 *
 * The sheet does NOT auto-close on selecting a thread — Next.js navigation
 * via the <Link> inside ThreadList replaces the page (which remounts the
 * /concierge route entirely), so the sheet unmounts naturally.
 */
export function MobileThreadSwitcher({
  threads,
  activeThreadId,
  showArchived,
}: MobileThreadSwitcherProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Open thread list"
          className="md:hidden flex items-center gap-2"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm">All threads ({threads.length})</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 p-4">
        <SheetHeader>
          <SheetTitle>Threads</SheetTitle>
          <SheetDescription className="sr-only">
            Switch between Concierge threads, archive a thread, or start a new conversation.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <ThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            showArchived={showArchived}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
