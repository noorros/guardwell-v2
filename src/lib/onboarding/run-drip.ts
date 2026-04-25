// src/lib/onboarding/run-drip.ts
//
// Daily runner for the 5-email onboarding drip per
// docs/specs/onboarding-flow.md § Screen 9 / Phase E. Idempotent: each
// (practiceId, day) tuple is uniqued in OnboardingDripSent so a missed
// cron tick replays cleanly.
//
// Per practice, in order:
//   1. Skip practices outside the 14-day post-trial-start window.
//   2. Find the OWNER's recipient email (single OWNER per practice).
//   3. Compute the personalization context (compliance score + top gaps).
//   4. Run selectDripDays + send the email for each due day.
//   5. Insert OnboardingDripSent before the send so retries skip cleanly.

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import {
  getPracticeJurisdictions,
  jurisdictionRequirementFilter,
} from "@/lib/compliance/jurisdictions";
import { composeDripEmail, type DripContext, type DripGap } from "./drip-content";
import { selectDripDays, type DripSubscriptionStatus } from "./select-drip-day";
import type { DripDay } from "./drip-content";

export interface DripRunSummary {
  practicesScanned: number;
  emailsAttempted: number;
  emailsDelivered: number;
  errors: Array<{ practiceId?: string; day?: number; message: string }>;
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const SEVERITY_REASON: Record<string, string> = {
  CRITICAL: "Critical-severity HIPAA requirement",
  HIGH: "High-severity HIPAA requirement",
  MEDIUM: "Medium-severity requirement",
  LOW: "Recommended next step",
};

export async function runOnboardingDrip(args?: {
  /** Override "now" for testing. */
  now?: Date;
  /** Limit scan to a single practiceId — also for testing. */
  practiceId?: string;
}): Promise<DripRunSummary> {
  const now = args?.now ?? new Date();
  const summary: DripRunSummary = {
    practicesScanned: 0,
    emailsAttempted: 0,
    emailsDelivered: 0,
    errors: [],
  };

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";

  // Scope to TRIALING/ACTIVE/PAST_DUE (CANCELED + INCOMPLETE filtered out
  // by selectDripDays anyway, but pre-filtering trims the loop). Practices
  // without a trialEndsAt won't have any drip days due.
  const candidates = await db.practice.findMany({
    where: {
      deletedAt: null,
      ...(args?.practiceId ? { id: args.practiceId } : {}),
      subscriptionStatus: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
      trialEndsAt: { not: null },
    },
    select: {
      id: true,
      name: true,
      primaryState: true,
      operatingStates: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      firstRunCompletedAt: true,
    },
  });

  for (const practice of candidates) {
    summary.practicesScanned += 1;
    try {
      const sentRows = await db.onboardingDripSent.findMany({
        where: { practiceId: practice.id },
        select: { day: true },
      });
      const alreadySentDays = new Set<DripDay>(
        sentRows.map((r) => r.day as DripDay),
      );

      const selection = selectDripDays({
        subscriptionStatus: practice.subscriptionStatus as DripSubscriptionStatus,
        trialEndsAt: practice.trialEndsAt,
        alreadySentDays,
        now,
      });
      if (selection.daysDue.length === 0) continue;

      // Resolve OWNER recipient. We send to the single OWNER (per the
      // single-OWNER product convention) — ADMIN/STAFF aren't the right
      // audience for "your trial ends" or activation emails.
      const ownerLink = await db.practiceUser.findFirst({
        where: {
          practiceId: practice.id,
          role: "OWNER",
          removedAt: null,
        },
        select: { user: { select: { id: true, email: true } } },
      });
      if (!ownerLink?.user.email) {
        summary.errors.push({
          practiceId: practice.id,
          message: "no OWNER email — skipping",
        });
        continue;
      }

      const context = await buildDripContext({
        practice,
        recipientEmail: ownerLink.user.email,
        baseUrl,
      });

      for (const day of selection.daysDue) {
        // Insert the OnboardingDripSent row BEFORE the email send so a
        // retry after a transient send failure doesn't double-fire.
        // The unique (practiceId, day) constraint means this either
        // succeeds (we own the send) or throws (another runner won).
        try {
          await db.onboardingDripSent.create({
            data: {
              practiceId: practice.id,
              day,
              recipientEmail: ownerLink.user.email,
              emailDelivered: false,
            },
          });
        } catch {
          // Another runner already claimed this day — skip silently.
          continue;
        }

        summary.emailsAttempted += 1;
        const email = composeDripEmail(day, context);
        const result = await sendEmail({
          to: ownerLink.user.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });

        await db.onboardingDripSent.update({
          where: {
            practiceId_day: { practiceId: practice.id, day },
          },
          data: {
            emailDelivered: result.delivered,
            emailReason: result.reason ?? null,
          },
        });

        if (result.delivered) summary.emailsDelivered += 1;
        else
          summary.errors.push({
            practiceId: practice.id,
            day,
            message: result.reason ?? "delivery failed",
          });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ practiceId: practice.id, message });
    }
  }

  return summary;
}

interface BuildContextArgs {
  practice: {
    id: string;
    name: string;
    primaryState: string;
    operatingStates: string[];
    subscriptionStatus: string;
    trialEndsAt: Date | null;
    firstRunCompletedAt: Date | null;
  };
  recipientEmail: string;
  baseUrl: string;
}

async function buildDripContext(args: BuildContextArgs): Promise<DripContext> {
  const { practice, recipientEmail, baseUrl } = args;

  // Same applicability scoping as the audit overview page so the
  // "current score" the email cites matches what the user sees in app.
  const jurisdictions = getPracticeJurisdictions({
    primaryState: practice.primaryState,
    operatingStates: practice.operatingStates,
  });
  const jurisdictionClause = jurisdictionRequirementFilter(jurisdictions);

  const [applicableRequirements, complianceItems] = await Promise.all([
    db.regulatoryRequirement.findMany({
      where: {
        ...jurisdictionClause,
        framework: {
          practiceFrameworks: {
            some: {
              practiceId: practice.id,
              enabled: true,
              disabledAt: null,
            },
          },
        },
      },
      select: {
        id: true,
        title: true,
        severity: true,
        framework: { select: { code: true } },
      },
    }),
    db.complianceItem.findMany({
      where: { practiceId: practice.id },
      select: { requirementId: true, status: true },
    }),
  ]);

  const applicableIds = new Set(applicableRequirements.map((r) => r.id));
  const compliantApplicable = complianceItems.filter(
    (ci) => ci.status === "COMPLIANT" && applicableIds.has(ci.requirementId),
  ).length;
  const totalApplicable = applicableRequirements.length;
  const currentScore =
    totalApplicable === 0
      ? 0
      : Math.round((compliantApplicable / totalApplicable) * 100);

  // Top gaps — applicable + status=GAP, sorted by severity, take top 3.
  const reqById = new Map(applicableRequirements.map((r) => [r.id, r]));
  const gapItems = complianceItems
    .filter((ci) => ci.status === "GAP" && applicableIds.has(ci.requirementId))
    .map((ci) => reqById.get(ci.requirementId))
    .filter((r): r is (typeof applicableRequirements)[number] => Boolean(r))
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 99) -
        (SEVERITY_RANK[b.severity] ?? 99),
    )
    .slice(0, 3);

  const topGaps: DripGap[] = gapItems.map((r) => ({
    title: r.title,
    reason: SEVERITY_REASON[r.severity] ?? "Open compliance item",
    href: `/modules/${r.framework.code.toLowerCase()}`,
  }));

  return {
    practiceName: practice.name,
    recipientEmail,
    currentScore,
    firstRunCompleted: Boolean(practice.firstRunCompletedAt),
    topGaps,
    trialEndsAt: practice.trialEndsAt,
    baseUrl,
  };
}
