"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiAssistDrawer, type AiAssistPageContext } from ".";

export interface AiAssistTriggerProps {
  pageContext: AiAssistPageContext;
  className?: string;
}

export function AiAssistTrigger({ pageContext, className }: AiAssistTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
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
      <AiAssistDrawer
        open={open}
        onOpenChange={setOpen}
        pageContext={pageContext}
      />
    </>
  );
}
