import type { NextConfig } from "next";

// v2 CSP — nonce-based, no 'unsafe-inline' (one of the v1 deferred items
// per memory M9). Inline scripts must use the nonce supplied by proxy.ts.
const cspNonceMode = process.env.CSP_NONCE_MODE !== "off";

const nextConfig: NextConfig = {
  output: "standalone",

  // Strict typed routes — v2 catches broken `<Link href="/foo">` at build time.
  typedRoutes: true,

  // experimental.useCache + reactCompiler can be enabled later when stable.

  async headers() {
    const cspBase = [
      "default-src 'self'",
      // Nonce-based CSP — proxy.ts injects a per-request nonce. The fallback
      // `unsafe-inline` is ignored by browsers that support `'nonce-…'`,
      // kept only to avoid blocking dev tooling that doesn't propagate the
      // nonce. Strip it from prod once everything is verified.
      cspNonceMode
        ? "script-src 'self' 'nonce-{NONCE}' 'strict-dynamic' https://js.stripe.com https://apis.google.com"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://apis.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://storage.googleapis.com https://*.googleusercontent.com",
      "font-src 'self'",
      "connect-src 'self' https://api.stripe.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.firebaseio.com https://firebaseinstallations.googleapis.com",
      "frame-src https://js.stripe.com https://accounts.google.com https://guardwell-prod.firebaseapp.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: cspBase },
        ],
      },
    ];
  },
};

export default nextConfig;
