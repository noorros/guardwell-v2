// src/app/(dashboard)/programs/get-started/page.tsx
//
// Defensive redirect. The Compliance Track lives at /programs/track;
// users sometimes type or bookmark /programs/get-started (matching the
// sidebar label). Redirect rather than 404.

import type { Route } from "next";
import { redirect } from "next/navigation";

export const metadata = { title: "Get started · Redirect" };

export default function GetStartedRedirectPage(): never {
  redirect("/programs/track" as Route);
}
