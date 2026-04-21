"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AiAssistDrawer, type AiAssistPageContext } from ".";

export interface AiAssistTriggerProps {
  pageContext: AiAssistPageContext;
  className?: string;
}

export function AiAssistTrigger({ pageContext, className }: AiAssistTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className={className}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Ask AI
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-xs">
            Ask a question about this page — Claude answers using the page
            you are on for context. Won&apos;t change any statuses; just
            explains things.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <AiAssistDrawer
        open={open}
        onOpenChange={setOpen}
        pageContext={pageContext}
      />
    </>
  );
}
