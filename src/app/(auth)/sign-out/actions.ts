// src/app/(auth)/sign-out/actions.ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Clears the fb-token auth cookie (set by /api/auth/sync) and sends the user
 * back to the sign-in page. Meant to be used as a <form action={signOutAction}>
 * target so it works without JavaScript.
 */
export async function signOutAction() {
  const cookieStore = await cookies();
  cookieStore.delete("fb-token");
  redirect("/sign-in");
}
