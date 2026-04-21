// src/components/gw/AiAssistDrawer/AiAssistDrawer.stories.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AiAssistDrawer } from ".";

function Demo({ summary }: { summary?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Open AI Concierge
      </Button>
      <AiAssistDrawer
        open={open}
        onOpenChange={setOpen}
        pageContext={{ route: "/modules/hipaa-privacy", summary, practiceId: "prac_demo" }}
      />
    </>
  );
}

export const stories = {
  Closed: <Demo />,
  DashboardContext: <Demo summary="Dashboard overview" />,
  ModuleContext: <Demo summary="HIPAA Privacy Rule module" />,
};
