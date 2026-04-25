// src/lib/onboarding/drip-content.ts
//
// Pure composers for the 5-email onboarding drip. Each function takes a
// {practice, recipient, baseUrl} context and returns subject + text + html.
// Lives in src/lib/onboarding so the cron runner + ad-hoc resends can both
// reuse the exact same copy. No DB access here — callers pass everything
// in.
//
// Days follow docs/specs/onboarding-flow.md § Screen 9 (Phase E):
//   1  → "Welcome — your 30-minute first-run guide"
//   3  → "How's your compliance score?"
//   5  → "Did you know? Average OCR fine for missing P&P is $47k"
//   7  → "Your trial ends in 24 hours"
//   10 → "How's it going? Reply with feedback"

import { renderEmailHtml } from "@/lib/email/template";

export const DRIP_DAYS = [1, 3, 5, 7, 10] as const;
export type DripDay = (typeof DRIP_DAYS)[number];

export interface DripGap {
  /** Display title (already user-friendly) — e.g. "Conduct a Security Risk Assessment". */
  title: string;
  /** Short reason this is high leverage — single line. */
  reason: string;
  /** Optional in-app link, joined to baseUrl. */
  href?: string;
}

export interface DripContext {
  practiceName: string;
  recipientEmail: string;
  /** Compliance score 0-100 across all enabled frameworks. */
  currentScore: number;
  /** First-run wizard finished? Drives Day-1 link target. */
  firstRunCompleted: boolean;
  /** Up to 3 highest-leverage open gaps. May be fewer if practice is mostly-compliant. */
  topGaps: DripGap[];
  /** Trial-end ISO timestamp. Day-7 email uses this for the countdown copy. */
  trialEndsAt: Date | null;
  /** Base URL for absolute links. Defaults to v2.app.gwcomp.com if not set. */
  baseUrl: string;
}

export interface DripEmail {
  subject: string;
  text: string;
  html: string;
}

const CAL_BOOKING_URL = "https://cal.com/guardwell/15min";

function abs(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function formatGapsText(gaps: DripGap[]): string {
  if (gaps.length === 0) return "  · No urgent gaps right now — keep it up.";
  return gaps.map((g) => `  · ${g.title} — ${g.reason}`).join("\n");
}

function formatGapsHtml(gaps: DripGap[], baseUrl: string): string {
  if (gaps.length === 0) {
    return `<p style="margin:0;">No urgent gaps right now — your top requirements are already in good shape.</p>`;
  }
  const items = gaps
    .map((g) => {
      const titleHtml = g.href
        ? `<a href="${abs(baseUrl, g.href)}" style="color:#2563EB; text-decoration:underline;">${escape(g.title)}</a>`
        : escape(g.title);
      return `<li style="margin-bottom:6px;">${titleHtml} — <span style="color:#64748B;">${escape(g.reason)}</span></li>`;
    })
    .join("");
  return `<ul style="margin:0; padding-left:20px;">${items}</ul>`;
}

function escape(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hoursUntil(date: Date | null): number | null {
  if (!date) return null;
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.round(ms / (60 * 60 * 1000));
}

// ────────────────────────────────────────────────────────────────────────
// Day 1
// ────────────────────────────────────────────────────────────────────────

export function composeDay1(ctx: DripContext): DripEmail {
  const guideHref = ctx.firstRunCompleted ? "/programs/track" : "/onboarding/first-run";
  const guideLabel = ctx.firstRunCompleted
    ? "Open your Compliance Track"
    : "Start your 30-minute first-run guide";
  const subject = `Welcome to GuardWell — start your 30-minute setup`;

  const text = [
    `Welcome to GuardWell, ${ctx.practiceName}.`,
    ``,
    `Most practices reach compliance score 30 within 20 minutes of signing up. Here's what we'll walk through together:`,
    ``,
    `  · Designate yourself as Privacy + Security Officer`,
    `  · Adopt your first HIPAA policy from a template`,
    `  · Take HIPAA Basics training`,
    `  · Invite the rest of your team`,
    ``,
    `${guideLabel}: ${abs(ctx.baseUrl, guideHref)}`,
    ``,
    `Reply to this email if you get stuck — a real human reads every reply.`,
  ].join("\n");

  const html = renderEmailHtml({
    preheader: "Most practices reach compliance score 30 within 20 minutes.",
    headline: `Welcome — let's get you to compliance score 30`,
    subheadline: `15-20 minutes is all it takes for your first wins.`,
    sections: [
      {
        html: `<p style="margin:0 0 8px;">Most practices reach compliance score 30 within 20 minutes of signing up. Here's what we'll walk through together:</p>
<ul style="margin:0; padding-left:20px;">
  <li>Designate yourself as Privacy + Security Officer</li>
  <li>Adopt your first HIPAA policy from a template</li>
  <li>Take HIPAA Basics training</li>
  <li>Invite the rest of your team</li>
</ul>`,
      },
      {
        html: `<p style="margin:0; color:#64748B;">Reply to this email if you get stuck — a real human reads every reply.</p>`,
      },
    ],
    cta: { label: guideLabel, href: abs(ctx.baseUrl, guideHref) },
    practiceName: ctx.practiceName,
    baseUrl: ctx.baseUrl,
  });

  return { subject, text, html };
}

// ────────────────────────────────────────────────────────────────────────
// Day 3
// ────────────────────────────────────────────────────────────────────────

export function composeDay3(ctx: DripContext): DripEmail {
  const dashHref = abs(ctx.baseUrl, "/dashboard");
  const subject = `Your compliance score: ${ctx.currentScore}`;

  const text = [
    `Hi ${ctx.practiceName},`,
    ``,
    `Your current compliance score is ${ctx.currentScore} out of 100.`,
    ``,
    ctx.topGaps.length > 0
      ? `The biggest open items right now:`
      : `You're on track — no urgent gaps.`,
    ctx.topGaps.length > 0 ? formatGapsText(ctx.topGaps) : ``,
    ``,
    `View your full compliance dashboard: ${dashHref}`,
  ].join("\n");

  const html = renderEmailHtml({
    preheader: `Score: ${ctx.currentScore}/100. Here's what would move it up the most.`,
    headline: `Your compliance score: ${ctx.currentScore}`,
    subheadline: ctx.topGaps.length > 0
      ? `The biggest open items right now`
      : `You're on track — no urgent gaps.`,
    sections: [
      ctx.topGaps.length > 0
        ? { html: formatGapsHtml(ctx.topGaps, ctx.baseUrl) }
        : {
            html: `<p style="margin:0;">Your top requirements are already covered. Keep an eye on the dashboard for upcoming review deadlines.</p>`,
          },
    ],
    cta: { label: "Open your dashboard", href: dashHref },
    practiceName: ctx.practiceName,
    baseUrl: ctx.baseUrl,
  });

  return { subject, text, html };
}

// ────────────────────────────────────────────────────────────────────────
// Day 5
// ────────────────────────────────────────────────────────────────────────

export function composeDay5(ctx: DripContext): DripEmail {
  const policiesHref = abs(ctx.baseUrl, "/programs/policies");
  const subject = `Average OCR fine for missing P&P: $47,000`;

  const text = [
    `${ctx.practiceName},`,
    ``,
    `HHS OCR's enforcement data shows the average fine for missing or stale policies and procedures is around $47,000 — and that's before factoring in legal fees and the time spent responding to a Request for Information.`,
    ``,
    `GuardWell ships with 130+ ready-to-adopt policy templates covering HIPAA, OSHA, state-specific requirements, and beyond. Pick the ones that apply to your practice and they're yours in a click.`,
    ``,
    `Browse the template library: ${policiesHref}`,
  ].join("\n");

  const html = renderEmailHtml({
    preheader: "130+ ready-to-adopt templates. Pick the ones that fit.",
    headline: `Average OCR fine for missing P&P: $47,000`,
    subheadline: `Don't be the practice that learned this the hard way.`,
    sections: [
      {
        html: `<p style="margin:0 0 8px;">HHS OCR's enforcement data shows the average fine for missing or stale policies and procedures is around <strong>$47,000</strong> — before legal fees or the time spent responding to a Request for Information.</p>
<p style="margin:0;">GuardWell ships with 130+ ready-to-adopt policy templates covering HIPAA, OSHA, state-specific requirements, and beyond. Pick the ones that apply to your practice and they're yours in a click.</p>`,
      },
    ],
    cta: { label: "Browse the template library", href: policiesHref },
    practiceName: ctx.practiceName,
    baseUrl: ctx.baseUrl,
  });

  return { subject, text, html };
}

// ────────────────────────────────────────────────────────────────────────
// Day 7
// ────────────────────────────────────────────────────────────────────────

export function composeDay7(ctx: DripContext): DripEmail {
  const billingHref = abs(ctx.baseUrl, "/settings/billing");
  const hours = hoursUntil(ctx.trialEndsAt);
  const headline =
    hours === null || hours <= 0
      ? `Your trial is ending`
      : hours <= 24
        ? `Your trial ends in ${hours} hours`
        : `Your trial ends soon`;
  const subject = headline;

  const text = [
    `${ctx.practiceName},`,
    ``,
    `${headline}. To keep using GuardWell after the trial, confirm your payment method or switch to annual to save $600.`,
    ``,
    `Your current compliance score is ${ctx.currentScore}/100 — a strong foundation to build on.`,
    ``,
    `Manage your subscription: ${billingHref}`,
    ``,
    `If you'd rather cancel, no hard feelings — same link. We'll keep your data for 30 days in case you change your mind.`,
  ].join("\n");

  const html = renderEmailHtml({
    preheader: `Score: ${ctx.currentScore}/100. Manage your subscription before the trial ends.`,
    headline,
    subheadline: `Confirm payment, switch to annual, or cancel — your choice.`,
    accent: "warning",
    sections: [
      {
        html: `<p style="margin:0 0 8px;">Your current compliance score is <strong>${ctx.currentScore}/100</strong> — a strong foundation to build on. To keep using GuardWell after the trial, confirm your payment method or switch to annual to save $600.</p>
<p style="margin:0; color:#64748B;">If you'd rather cancel, no hard feelings — same link. We'll keep your data for 30 days in case you change your mind.</p>`,
      },
    ],
    cta: { label: "Manage subscription", href: billingHref },
    practiceName: ctx.practiceName,
    baseUrl: ctx.baseUrl,
  });

  return { subject, text, html };
}

// ────────────────────────────────────────────────────────────────────────
// Day 10
// ────────────────────────────────────────────────────────────────────────

export function composeDay10(ctx: DripContext): DripEmail {
  const subject = `How's GuardWell working for you, ${ctx.practiceName}?`;

  const text = [
    `Hi ${ctx.practiceName},`,
    ``,
    `Quick check-in. You've been using GuardWell for about 10 days.`,
    ``,
    `Two questions:`,
    `  1. What's working?`,
    `  2. What's not?`,
    ``,
    `Just hit reply. Founder reads every email.`,
    ``,
    `If you'd rather chat live: ${CAL_BOOKING_URL} (15-min slot)`,
  ].join("\n");

  const html = renderEmailHtml({
    preheader: `Two questions, hit reply. Founder reads every email.`,
    headline: `How's GuardWell working for you?`,
    subheadline: `Two questions. Hit reply. Founder reads every email.`,
    sections: [
      {
        html: `<p style="margin:0 0 8px;">Quick check-in. You've been using GuardWell for about 10 days.</p>
<p style="margin:0;"><strong>1.</strong> What's working?<br /><strong>2.</strong> What's not?</p>`,
      },
      {
        html: `<p style="margin:0; color:#64748B;">Just hit reply. Or grab a 15-minute slot if you'd rather chat live.</p>`,
      },
    ],
    cta: { label: "Book a 15-min call", href: CAL_BOOKING_URL },
    practiceName: ctx.practiceName,
    baseUrl: ctx.baseUrl,
  });

  return { subject, text, html };
}

// ────────────────────────────────────────────────────────────────────────
// Dispatch
// ────────────────────────────────────────────────────────────────────────

export function composeDripEmail(day: DripDay, ctx: DripContext): DripEmail {
  switch (day) {
    case 1:
      return composeDay1(ctx);
    case 3:
      return composeDay3(ctx);
    case 5:
      return composeDay5(ctx);
    case 7:
      return composeDay7(ctx);
    case 10:
      return composeDay10(ctx);
  }
}
