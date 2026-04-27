// src/app/pricing/route.ts
//
// /pricing on the app subdomain is a permanent redirect to the marketing
// site's pricing page. The app subdomain doesn't host marketing chrome,
// and we don't want two pricing pages drifting out of sync — single
// source of truth lives on gwcomp.com.

import { NextResponse } from "next/server";

const TARGET = "https://gwcomp.com/pricing";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.redirect(TARGET, 308);
}
