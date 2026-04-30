"use client";

import { createContext, useContext, type ReactNode } from "react";

const PracticeTimezoneContext = createContext<string>("UTC");

export function PracticeTimezoneProvider({
  value,
  children,
}: {
  value: string | null | undefined;
  children: ReactNode;
}) {
  // Normalize null/undefined to UTC so consumers always get a string.
  return (
    <PracticeTimezoneContext.Provider value={value ?? "UTC"}>
      {children}
    </PracticeTimezoneContext.Provider>
  );
}

/**
 * Returns the practice's IANA timezone ("UTC" if no provider is mounted).
 * Used by badges + dashboard pages to format dates consistently with
 * server-side PDF/notification rendering.
 */
export function usePracticeTimezone(): string {
  return useContext(PracticeTimezoneContext);
}
