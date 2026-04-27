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
  SheetTrigger,
} from "@/components/ui/sheet";
import { Sidebar, type MyComplianceItem } from "./Sidebar";

export interface MobileSidebarTriggerProps {
  myComplianceItems: MyComplianceItem[];
  enabledFrameworkCodes?: string[];
}

/**
 * Hamburger shown on < md viewports. Opens a left-side Sheet containing the
 * same Sidebar used on desktop. Closes itself on navigation so the drawer
 * does not linger over the newly-loaded page.
 */
export function MobileSidebarTrigger({
  myComplianceItems,
  enabledFrameworkCodes,
}: MobileSidebarTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Open navigation"
          className="md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Primary site navigation</SheetDescription>
        </SheetHeader>
        <Sidebar
          myComplianceItems={myComplianceItems}
          enabledFrameworkCodes={enabledFrameworkCodes}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
