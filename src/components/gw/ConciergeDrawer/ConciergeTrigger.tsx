// src/components/gw/ConciergeDrawer/ConciergeTrigger.tsx
//
// Floating bottom-right button that opens the global ConciergeDrawer.
// Mounted once per dashboard layout (see src/app/(dashboard)/layout.tsx).
//
// Keyboard shortcut: cmd+/ on macOS, ctrl+/ on Windows/Linux. The shortcut
// toggles the drawer open/closed so power users can dismiss it without
// reaching for the mouse.
//
// Persistence: drawer-open state survives navigation between dashboard
// pages via localStorage under "gw-concierge-drawer-open". The drawer's
// own state (messages, threadIdOverride) lives in component state and is
// reset on full reload — but the threadId is independently persisted by
// the drawer itself so a reload picks up the same conversation.
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConciergeDrawer } from ".";

const STORAGE_KEY_OPEN = "gw-concierge-drawer-open";

// useSyncExternalStore subscribers + snapshots for localStorage-backed
// drawer-open state. SSR returns "0" (drawer closed) so the server +
// client first-paint match.
function subscribeOpenStorage(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
function getStoredOpen(): "0" | "1" {
  if (typeof window === "undefined") return "0";
  return window.localStorage.getItem(STORAGE_KEY_OPEN) === "1" ? "1" : "0";
}
function getServerOpen(): "0" {
  return "0";
}

// Same shape for the platform string. JSDOM returns "" so the relevant
// branch picks "Ctrl+/" — fine for tests.
function subscribeNoop() {
  return () => {};
}
function getPlatformString(): string {
  if (typeof navigator === "undefined") return "";
  type UADataPlatform = { platform?: string };
  const uad =
    typeof navigator === "object" && "userAgentData" in navigator
      ? ((navigator as unknown as { userAgentData?: UADataPlatform })
          .userAgentData ?? null)
      : null;
  return uad?.platform ?? navigator.platform ?? "";
}
function getServerPlatformString(): string {
  return "";
}

export function ConciergeTrigger() {
  // Persisted drawer-open snapshot from localStorage. Cross-tab updates
  // arrive via the storage event; same-tab updates use the override.
  const persistedOpen = useSyncExternalStore<"0" | "1">(
    subscribeOpenStorage,
    getStoredOpen,
    getServerOpen,
  );
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? persistedOpen === "1";
  // Lazy-mount: only render the drawer component once the user has opened
  // it for the first time. `hasOpened` flips true the moment a setOpen
  // call (or shortcut) opens the drawer; thereafter it stays true so the
  // drawer keeps its in-memory state across close/reopen within a session.
  const [hasOpened, setHasOpened] = useState(open);

  const platform = useSyncExternalStore<string>(
    subscribeNoop,
    getPlatformString,
    getServerPlatformString,
  );
  const isMac = /mac/i.test(platform);
  const shortcutLabel = isMac ? "Cmd+/" : "Ctrl+/";

  function setOpen(next: boolean | ((prev: boolean) => boolean)) {
    setOpenOverride((prev) => {
      const current = prev ?? persistedOpen === "1";
      const resolved = typeof next === "function" ? next(current) : next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY_OPEN, resolved ? "1" : "0");
      }
      return resolved;
    });
    if (next === true || (typeof next === "function" && !hasOpened)) {
      setHasOpened(true);
    }
  }

  // cmd+/ or ctrl+/ keyboard shortcut. Toggling instead of just opening
  // means the user can also dismiss the drawer via the same gesture.
  // Empty deps: handler closure reads only setState fns (stable refs).
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isModified = e.metaKey || e.ctrlKey;
      if (isModified && e.key === "/") {
        e.preventDefault();
        setOpenOverride((prev) => {
          const current =
            prev ??
            (typeof window !== "undefined" &&
              window.localStorage.getItem(STORAGE_KEY_OPEN) === "1");
          const resolved = !current;
          if (typeof window !== "undefined") {
            window.localStorage.setItem(
              STORAGE_KEY_OPEN,
              resolved ? "1" : "0",
            );
          }
          return resolved;
        });
        setHasOpened(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="lg"
              className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full p-0 shadow-lg"
              aria-label="Open GuardWell Concierge"
              onClick={() => setOpen((v) => !v)}
            >
              <Bot className="h-6 w-6" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Ask the Concierge ({shortcutLabel})
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {hasOpened && (
        <ConciergeDrawer open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}
