// src/components/gw/AiAssistDrawer/index.tsx
import { Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface AiAssistPageContext {
  route: string;
  summary?: string;
  practiceId?: string;
}

export interface AiAssistDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageContext: AiAssistPageContext;
  className?: string;
}

export function AiAssistDrawer({ open, onOpenChange, pageContext, className }: AiAssistDrawerProps) {
  // Greeting prefers summary; when absent we fall back to a generic phrase
  // so the route string remains unique to the header badge (avoids duplicate
  // text matches for accessible queries).
  const greeting = pageContext.summary ?? "this page";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("flex w-full flex-col sm:max-w-md", className)}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            AI Concierge
          </SheetTitle>
          <SheetDescription>
            Context-aware help for the current page.
          </SheetDescription>
          <div className="pt-1">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {pageContext.route}
            </Badge>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-foreground">
            I can see you&apos;re on <span className="font-medium">{greeting}</span>. What would you like help with?
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            (Connected responses arrive in week 5 — see ADR-0003.)
          </p>
        </div>

        <SheetFooter className="flex-col gap-2 border-t pt-3">
          <label htmlFor="ai-assist-input" className="sr-only">Ask the AI Concierge</label>
          <textarea
            id="ai-assist-input"
            disabled
            placeholder="Coming in week 5"
            rows={2}
            className="w-full resize-none rounded-md border bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground"
          />
          <Button type="button" disabled className="w-full">
            Send
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
