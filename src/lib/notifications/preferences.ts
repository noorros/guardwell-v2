// src/lib/notifications/preferences.ts
//
// Effective per-user preference resolution. Reads NotificationPreference
// row (or returns defaults if missing — new users haven't created theirs
// yet). Used by run-digest.ts (cadence routing) + per-channel send paths.

import type { NotificationPreference } from "@prisma/client";

export interface EffectivePreferences {
  digestEnabled: boolean;
  criticalAlertsEnabled: boolean;
  emailEnabled: boolean;
  cadence: "INSTANT" | "DAILY" | "WEEKLY" | "NONE";
  channels: Set<"EMAIL" | "IN_APP">;
  /**
   * User's category allowlist. EMPTY SET = no filter (all categories
   * surface in the digest). Non-empty = only those categories are
   * included. Mirrors the @default([]) semantic in the schema.
   */
  categoryFilters: Set<string>;
  digestTime: string;
  digestDay: string;
}

const DEFAULTS: EffectivePreferences = {
  digestEnabled: true,
  criticalAlertsEnabled: true,
  emailEnabled: true,
  cadence: "DAILY",
  channels: new Set(["EMAIL", "IN_APP"]),
  categoryFilters: new Set(),
  digestTime: "08:00",
  digestDay: "MON",
};

export function getEffectivePreferences(
  pref: NotificationPreference | null,
): EffectivePreferences {
  if (!pref) {
    // Defensive copy of defaults so callers can't mutate shared state.
    return {
      digestEnabled: DEFAULTS.digestEnabled,
      criticalAlertsEnabled: DEFAULTS.criticalAlertsEnabled,
      emailEnabled: DEFAULTS.emailEnabled,
      cadence: DEFAULTS.cadence,
      channels: new Set(DEFAULTS.channels),
      categoryFilters: new Set(DEFAULTS.categoryFilters),
      digestTime: DEFAULTS.digestTime,
      digestDay: DEFAULTS.digestDay,
    };
  }
  return {
    digestEnabled: pref.digestEnabled,
    criticalAlertsEnabled: pref.criticalAlertsEnabled,
    emailEnabled: pref.emailEnabled,
    cadence: parseCadence(pref.cadence),
    channels: new Set(pref.channels.filter(isChannel)),
    categoryFilters: new Set(pref.categoryFilters),
    digestTime: pref.digestTime,
    digestDay: pref.digestDay,
  };
}

function parseCadence(raw: string): EffectivePreferences["cadence"] {
  if (raw === "INSTANT" || raw === "DAILY" || raw === "WEEKLY" || raw === "NONE")
    return raw;
  return "DAILY";
}

function isChannel(c: string): c is "EMAIL" | "IN_APP" {
  return c === "EMAIL" || c === "IN_APP";
}
