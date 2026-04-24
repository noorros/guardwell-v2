// Next.js 16 middleware.
//
// Three responsibilities:
//  1. Generate a per-request CSP nonce + set the Content-Security-Policy
//     response header. (Note: nonce-based strict CSP is upstream-blocked;
//     Next.js 16 + Turbopack don't auto-inject nonces into framework-
//     emitted <script> tags. We use a hardened `unsafe-inline` config
//     until that lands. See buildCspHeader for details.)
//  2. Set the rest of the OWASP secure-headers baseline (HSTS, X-CTO,
//     Referrer-Policy, Permissions-Policy, COOP, CORP).
//  3. Lightweight cookie gate on authenticated routes — full token
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
    // Block mixed content + force browsers to upgrade insecure subresources.
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * OWASP-baseline security headers that are NOT covered by the CSP
 * builder above. Applied to every response so static assets + API
 * responses get the same hardening. Idempotent — overwriting any
 * pre-existing value with our own.
 */
function applySecurityHeaders(headers: Headers): void {
  // 1 year HSTS with preload + subdomains. v2 is HTTPS-only behind
  // Cloud Run; HSTS keeps it that way against any future TLS-strip MITM.
  headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
  // Disable MIME-type sniffing — pair with proper Content-Type on every response.
  headers.set("X-Content-Type-Options", "nosniff");
  // Don't leak referrer to cross-origin destinations.
  headers.set(
    "Referrer-Policy",
    "strict-origin-when-cross-origin",
  );
  // Disable browser features we don't use. Minimizes attack surface
  // for any compromised script that might try to call into them.
  headers.set(
    "Permissions-Policy",
    [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "interest-cohort=()",
      "payment=(self \"https://js.stripe.com\")",
    ].join(", "),
  );
  // Cross-origin isolation defaults. Pair with frame-ancestors 'none'
  // (already in CSP) for clickjacking prevention.
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  // Modern, supported by Chromium-based browsers; harmless in others.
  // Hides our X-Powered-By + Server identifiers if present.
  headers.set("X-Frame-Options", "DENY"); // legacy fallback for frame-ancestors
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
      applySecurityHeaders(res.headers);
      return res;
    }

    const redirectTo = isValidRedirect(`${pathname}${search}`)
      ? `${pathname}${search}`
      : "/";
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect", redirectTo);
    const res = NextResponse.redirect(signInUrl);
    res.headers.set("Content-Security-Policy", csp);
    applySecurityHeaders(res.headers);
    return res;
  }

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", csp);
  applySecurityHeaders(response.headers);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
