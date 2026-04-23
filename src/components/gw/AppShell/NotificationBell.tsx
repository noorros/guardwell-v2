// src/components/gw/AppShell/NotificationBell.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { markNotificationReadAction } from "@/app/(dashboard)/settings/notifications/actions";

export interface NotificationBellItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  href: string | null;
  createdAtIso: string;
  readAt: string | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "var(--gw-color-risk)",
  WARNING: "var(--gw-color-needs)",
  INFO: "var(--gw-color-setup)",
};

export function NotificationBell({
  unreadCount,
  recent,
}: {
  unreadCount: number;
  recent: NotificationBellItem[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markNotificationReadAction({ ids: recent.map((n) => n.id) });
      router.refresh();
    });
  };

  const handleMarkOneRead = (id: string) => {
    startTransition(async () => {
      await markNotificationReadAction({ ids: [id] });
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[color:var(--gw-color-risk)] px-1 text-[10px] font-semibold text-white"
              aria-label={`${unreadCount} unread`}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-96 p-0"
        align="end"
        aria-label="Notifications"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Notifications
          </p>
          {recent.some((n) => n.readAt === null) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={isPending}
              className="h-6 text-[10px]"
            >
              Mark all read
            </Button>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No notifications yet.
          </div>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {recent.map((n) => (
              <li
                key={n.id}
                className={`space-y-1 p-3 text-xs ${
                  n.readAt ? "bg-background" : "bg-accent/40"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        SEVERITY_COLOR[n.severity] ??
                        "var(--gw-color-setup)",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{n.title}</p>
                    <p className="line-clamp-2 text-muted-foreground">
                      {n.body}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-[9px] uppercase"
                        style={{
                          borderColor:
                            SEVERITY_COLOR[n.severity] ??
                            "var(--gw-color-setup)",
                          color:
                            SEVERITY_COLOR[n.severity] ??
                            "var(--gw-color-setup)",
                        }}
                      >
                        {n.severity}
                      </Badge>
                      {n.href && (
                        <Link
                          href={n.href as Route}
                          onClick={() => {
                            setOpen(false);
                            handleMarkOneRead(n.id);
                          }}
                          className="text-[10px] font-medium text-foreground hover:underline"
                        >
                          Open →
                        </Link>
                      )}
                      {n.readAt === null && (
                        <button
                          type="button"
                          onClick={() => handleMarkOneRead(n.id)}
                          disabled={isPending}
                          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          <Check className="h-3 w-3" aria-hidden="true" />
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-3 py-2 text-right">
          <Link
            href={"/settings/notifications" as Route}
            onClick={() => setOpen(false)}
            className="text-[10px] text-muted-foreground hover:underline"
          >
            Preferences →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
