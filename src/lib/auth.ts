// Server-side auth helpers. Reads the Firebase ID-token cookie set by the
// /api/auth/sync route, verifies via Firebase Admin, and resolves to our
// User row.

import { cookies } from "next/headers";
import { verifyFirebaseToken } from "@/lib/firebase-admin";
import { db } from "@/lib/db";

const TOKEN_COOKIE = "fb-token";

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;
  if (!token) return null;

  let decoded;
  try {
    decoded = await verifyFirebaseToken(token);
  } catch {
    return null;
  }

  return db.user.findUnique({ where: { firebaseUid: decoded.uid } });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

/**
 * Gate for the /admin surface. Throws "Forbidden" (not "Unauthorized")
 * for signed-in non-admin users so the caller can render notFound() or
 * redirect rather than punting to /sign-in. Use this in every /admin/*
 * page + every /api/admin/* route.
 */
export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) throw new Error("Forbidden");
  return user;
}
