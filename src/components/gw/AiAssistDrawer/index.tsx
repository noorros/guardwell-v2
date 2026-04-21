// src/components/gw/AiAssistDrawer/index.tsx
"use client";

import { useState, useTransition } from "react";
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
import { askAiAssistantAction, type AskAiResult } from "./actions";

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
  /** Test-only: inject a fake action so component tests don't hit the server. */
  __actionForTests?: (input: {
    route: string;
    summary?: string;
    question: string;
  }) => Promise<AskAiResult>;
}

export function AiAssistDrawer({
  open,
  onOpenChange,
  pageContext,
  className,
  __actionForTests,
}: AiAssistDrawerProps) {
  const greeting = pageContext.summary ?? "this page";
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAiResult | null>(null);
  const [pending, start] = useTransition();

  const ask = __actionForTests ?? askAiAssistantAction;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAnswer(null);
    start(async () => {
      const res = await ask({
        route: pageContext.route,
        summary: pageContext.summary,
        question,
      });
      setAnswer(res);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("flex w-full flex-col sm:max-w-md", className)}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            AI Concierge
          </SheetTitle>
          <SheetDescription>Context-aware help for the current page.</SheetDescription>
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
          {answer?.ok === true && (
            <div className="mt-4 rounded-lg border bg-background p-3 text-sm">
              <p className="whitespace-pre-wrap">{answer.answer}</p>
              {answer.suggestNextAction && (
                <a
                  href={answer.suggestNextAction.href}
                  className="mt-2 inline-flex text-xs underline underline-offset-2"
                >
                  {answer.suggestNextAction.label}
                </a>
              )}
            </div>
          )}
          {answer?.ok === false && (
            <p className="mt-4 text-xs text-[color:var(--gw-color-risk)]">
              {answer.error}
            </p>
          )}
        </div>

        <SheetFooter className="border-t pt-3">
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <label htmlFor="ai-assist-input" className="sr-only">
              Ask the AI Concierge
            </label>
            <textarea
              id="ai-assist-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about this page…"
              rows={2}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
              disabled={pending}
            />
            <Button type="submit" disabled={pending || !question.trim()} className="w-full">
              {pending ? "Asking…" : "Send"}
            </Button>
          </form>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
