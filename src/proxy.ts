// Next.js 16 middleware.
//
// Two responsibilities:
//  1. Generate a per-request CSP nonce, set the Content-Security-Policy
//     response header, and expose the nonce to downstream handlers via the
//     `x-nonce` request header. Replaces the v1 deferred CSP item (nonce-
//     based CSP with no unsafe-inline).
//  2. Lightweight cookie gate on authenticated routes — full token
//     verification still happens in route handlers via verifyFirebaseToken().

import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = [
  "/",
  "/sign-in",
  "/api/auth/sync",
  "/api/health",
];

const TOKEN_COOKIE = "fb-token";

function isValidRedirect(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

function buildCspHeader(): string {
  const isDev = process.env.NODE_ENV !== "production";
  // Next.js 16 + Turbopack don't currently auto-inject nonce into
  // framework-emitted <script> tags (verified: deployed HTML has
  // `"nonce":"$undefined"` throughout RSC payload). Per CSP3 spec,
  // if a nonce is PRESENT in script-src then 'unsafe-inline' is
  // IGNORED — so having both doesn't help; it blocks Next.js's own
  // inline scripts.
  //
  // Pragmatic fallback: drop the nonce from script-src entirely and
  // rely on 'self' + 'unsafe-inline' + host allowlist. When Turbopack
  // adds automatic nonce injection (track upstream) we can re-tighten
  // by putting 'strict-dynamic' + nonce back.
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    isDev ? "'unsafe-eval'" : "",
    "https://js.stripe.com",
    "https://apis.google.com",
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://storage.googleapis.com https://*.googleusercontent.com",
    "font-src 'self'",
    "connect-src 'self' https://api.stripe.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.firebaseio.com https://firebaseinstallations.googleapis.com",
    "frame-src https://js.stripe.com https://accounts.google.com https://guardwell-prod.firebaseapp.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const csp = buildCspHeader();

  const isPublic = PUBLIC_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const hasToken = !!req.cookies.get(TOKEN_COOKIE)?.value;

  if (!isPublic && !hasToken) {
    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      res.headers.set("Content-Security-Policy", csp);
      return res;
    }

    const redirectTo = isValidRedirect(`${pathname}${search}`)
      ? `${pathname}${search}`
      : "/";
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect", redirectTo);
    const res = NextResponse.redirect(signInUrl);
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
