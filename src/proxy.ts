// Next.js 16 middleware — lightweight cookie check ONLY. Full token
// verification happens in route handlers via verifyFirebaseToken(). This
// middleware just gates which routes require a session cookie at all.

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

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  if (token) return NextResponse.next();

  const redirectTo = isValidRedirect(`${pathname}${search}`) ? `${pathname}${search}` : "/";
  const signInUrl = new URL("/sign-in", req.url);
  signInUrl.searchParams.set("redirect", redirectTo);

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
