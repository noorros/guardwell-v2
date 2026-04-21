// src/components/gw/AppShell/MobileSidebarTrigger.tsx
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
} from "@/components/ui/sheet";
import { Sidebar, type MyComplianceItem } from "./Sidebar";

export interface MobileSidebarTriggerProps {
  myComplianceItems: MyComplianceItem[];
}

/**
 * Hamburger shown on < md viewports. Opens a left-side Sheet containing the
 * same Sidebar used on desktop. Closes itself on navigation so the drawer
 * does not linger over the newly-loaded page.
 */
export function MobileSidebarTrigger({
  myComplianceItems,
}: MobileSidebarTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Open navigation"
        className="md:hidden"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Primary site navigation</SheetDescription>
        </SheetHeader>
        <Sidebar
          myComplianceItems={myComplianceItems}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
