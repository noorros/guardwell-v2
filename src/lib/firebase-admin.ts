// Lazy-initialized Firebase Admin singleton. Must NOT initialize at module
// load time — during `next build` the env vars are empty and initializeApp
// would throw "Service account object must contain a string project_id".

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let cachedAuth: Auth | undefined;

function getAdminApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export function getAdminAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getAdminApp());
  return cachedAuth;
}

/** Verify a Firebase ID token from a request. Throws if invalid. */
export async function verifyFirebaseToken(idToken: string) {
  return getAdminAuth().verifyIdToken(idToken);
}
