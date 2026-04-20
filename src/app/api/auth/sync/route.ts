// Called immediately after sign-in. Verifies the Firebase ID token, upserts
// the local User row keyed by firebaseUid, and sets the fb-token cookie.

import { NextResponse, type NextRequest } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase-admin";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const token = auth.slice("Bearer ".length);

  let decoded;
  try {
    decoded = await verifyFirebaseToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const user = await db.user.upsert({
    where: { firebaseUid: decoded.uid },
    update: { emailVerified: !!decoded.email_verified },
    create: {
      firebaseUid: decoded.uid,
      email: decoded.email ?? "",
      emailVerified: !!decoded.email_verified,
    },
  });

  const pu = await db.practiceUser.findFirst({
    where: { userId: user.id, removedAt: null },
  });

  const res = NextResponse.json({ userId: user.id, hasPractice: !!pu });
  res.cookies.set("fb-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
  return res;
}
