// src/lib/practice-cookie.ts
//
// Selected-practice cookie used by `getPracticeUser()` to drive multi-
// practice support (audit #7 / HIPAA B-3). Stores the user's currently
// active practiceId. Cookie value is treated as a HINT — the DB lookup
// in `getPracticeUser` always re-verifies that the userId+practiceId
// pair has an active PracticeUser row, so a tampered cookie can only
// select a practice the caller is ALREADY a member of (no escalation).
//
// Cookie attributes:
//   - httpOnly: yes (no JS read; UI uses server actions)
//   - sameSite: "lax" (matches the app's other cookies)
//   - path: "/" (visible to every server component / action)
//   - secure: true in prod, omitted in dev (Next.js handles this)

import { cookies } from "next/headers";

export const SELECTED_PRACTICE_COOKIE = "selectedPracticeId";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// `cookies()` throws outside of a request context (e.g. cron jobs,
// vitest direct calls into getPracticeUser, scripts). Treating that as
// "no cookie set" is the safe fall-back — the caller's lookup will use
// oldest-membership semantics, matching pre-audit-#7 behavior.
async function safeCookieStore() {
  try {
    return await cookies();
  } catch {
    return null;
  }
}

export async function getSelectedPracticeId(): Promise<string | null> {
  const store = await safeCookieStore();
  return store?.get(SELECTED_PRACTICE_COOKIE)?.value ?? null;
}

export async function setSelectedPracticeId(practiceId: string): Promise<void> {
  const store = await safeCookieStore();
  store?.set(SELECTED_PRACTICE_COOKIE, practiceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSelectedPracticeId(): Promise<void> {
  const store = await safeCookieStore();
  store?.delete(SELECTED_PRACTICE_COOKIE);
}
