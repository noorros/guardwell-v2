// src/app/(dashboard)/programs/cybersecurity/page.tsx
//
// Cybersecurity program surface — unifies the MFA, phishing, backup, and
// encryption signals into one readiness score + per-component cards. The
// score also feeds the HIPAA module page Section G CyberReadinessPanel.

import Link from "next/link";
import type { Route } from "next";
import {
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  GraduationCap,
  KeyRound,
  Mail,
  Database,
  Lock,
} from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  computeCyberReadiness,
  CYBER_COURSE_CODES,
  type CyberComponentScore,
} from "@/lib/cyber/readiness";
import { scoreToColorToken } from "@/lib/utils";
import { PhishingDrillForm } from "./PhishingDrillForm";
import { BackupVerificationForm } from "./BackupVerificationForm";
import { MfaToggle } from "./MfaToggle";

export const metadata = { title: "Cybersecurity · My Programs" };
export const dynamic = "force-dynamic";

const COMPONENT_ICONS: Record<string, typeof ShieldCheck> = {
  TRAINING: GraduationCap,
  MFA: KeyRound,
  PHISHING: Mail,
  BACKUP: Database,
  ENCRYPTION: Lock,
};

function statusIcon(status: CyberComponentScore["status"]) {
  if (status === "PASS")
    return (
      <CheckCircle2
        className="h-4 w-4 text-[color:var(--gw-color-compliant)]"
        aria-hidden="true"
      />
    );
  if (status === "FAIL")
    return (
      <AlertCircle
        className="h-4 w-4 text-[color:var(--gw-color-risk)]"
        aria-hidden="true"
      />
    );
  return (
    <CircleDashed
      className="h-4 w-4 text-muted-foreground"
      aria-hidden="true"
    />
  );
}

export default async function CybersecurityPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const snapshot = await computeCyberReadiness(db, pu.practiceId);
  const scoreColor = scoreToColorToken(snapshot.total);

  // Workforce list with MFA status — for the per-user MFA toggle table.
  const workforce = await db.practiceUser.findMany({
    where: { practiceId: pu.practiceId, removedAt: null },
    select: {
      id: true,
      mfaEnrolledAt: true,
      role: true,
      user: {
        select: { firstName: true, lastName: true, email: true },
      },
    },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });

  // Per-cyber-course completion roll-up (workforce coverage).
  const cyberCourses = await db.trainingCourse.findMany({
    where: { code: { in: [...CYBER_COURSE_CODES] } },
    select: { id: true, code: true, title: true },
  });
  const cyberCompletions = await db.trainingCompletion.findMany({
    where: {
      practiceId: pu.practiceId,
      courseId: { in: cyberCourses.map((c) => c.id) },
      passed: true,
      expiresAt: { gt: new Date() },
    },
    distinct: ["userId", "courseId"],
    select: { userId: true, courseId: true },
  });
  const completionsByCourse = new Map<string, Set<string>>();
  for (const c of cyberCompletions) {
    const set = completionsByCourse.get(c.courseId) ?? new Set<string>();
    set.add(c.userId);
    completionsByCourse.set(c.courseId, set);
  }

  // Recent drills + backup tests for the timeline at the bottom.
  const recentDrills = await db.phishingDrill.findMany({
    where: { practiceId: pu.practiceId },
    orderBy: { conductedAt: "desc" },
    take: 5,
  });
  const recentBackups = await db.backupVerification.findMany({
    where: { practiceId: pu.practiceId },
    orderBy: { verifiedAt: "desc" },
    take: 5,
  });

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "My Programs" }, { label: "Cybersecurity" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Cybersecurity
          </h1>
          <p className="text-sm text-muted-foreground">
            Aggregates the highest-leverage cyber controls — workforce
            training, MFA coverage, phishing drills, backup verification,
            and PHI encryption — into one readiness score that feeds the
            HIPAA module. Cyber insurance carriers and OCR investigators
            ask about every one of these.
          </p>
        </div>
      </header>

      {/* Readiness score header */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Cyber readiness score
              </p>
              <p
                className="text-4xl font-semibold tabular-nums"
                style={{ color: `var(--${scoreColor})` }}
              >
                {snapshot.total}
                <span className="text-base font-normal text-muted-foreground">
                  {" "}
                  / 100
                </span>
              </p>
            </div>
            <div className="text-right text-[11px] text-muted-foreground">
              <p>
                {snapshot.workforceWithMfa}/{snapshot.workforceTotal} staff
                MFA-enrolled
              </p>
              <p>
                {snapshot.phishingDrillCount} drill
                {snapshot.phishingDrillCount === 1 ? "" : "s"} ·{" "}
                {snapshot.backupVerificationCount} backup test
                {snapshot.backupVerificationCount === 1 ? "" : "s"} logged
              </p>
            </div>
          </div>
          <ul className="space-y-2 border-t pt-3">
            {snapshot.components.map((c) => {
              const Icon = COMPONENT_ICONS[c.key] ?? ShieldCheck;
              return (
                <li key={c.key} className="flex items-start gap-3">
                  <Icon
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        {statusIcon(c.status)}
                        {c.label}
                      </p>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {c.earned}/{c.max}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {c.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Cyber training coverage */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              Cyber training coverage
            </h2>
            <Link
              href={"/programs/training" as Route}
              className="text-[11px] text-foreground underline hover:no-underline"
            >
              Open training catalog →
            </Link>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Each row is one of the four core cybersecurity courses. Coverage
            is the percentage of active workforce who've passed the course
            with a non-expired completion.
          </p>
          {cyberCourses.length === 0 ? (
            <p className="text-xs text-[color:var(--gw-color-risk)]">
              Cyber courses not seeded — re-run npm run db:seed:training.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {cyberCourses.map((c) => {
                const covered = completionsByCourse.get(c.id)?.size ?? 0;
                const pct =
                  snapshot.workforceTotal > 0
                    ? Math.round((covered / snapshot.workforceTotal) * 100)
                    : 0;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-background/50 px-3 py-2"
                  >
                    <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {c.title}
                    </p>
                    <Badge variant="secondary" className="text-[10px] tabular-nums">
                      {covered}/{snapshot.workforceTotal} ({pct}%)
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* MFA enrollment per user */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              MFA enrollment
            </h2>
            <Badge variant="outline" className="text-[10px] tabular-nums">
              {snapshot.workforceWithMfa}/{snapshot.workforceTotal} enrolled
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Officer-attested. Toggle once you've confirmed each user has
            MFA enrolled on their email + EHR (and ideally hardware key /
            authenticator app, not SMS). Microsoft data: MFA blocks 99%+ of
            account-takeover attempts.
          </p>
          {workforce.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active staff.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {workforce.map((wu) => {
                const enrolled = wu.mfaEnrolledAt !== null;
                const fullName = [wu.user.firstName, wu.user.lastName]
                  .filter(Boolean)
                  .join(" ")
                  .trim();
                const label = fullName || wu.user.email || wu.id;
                return (
                  <li
                    key={wu.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate text-xs font-medium text-foreground">
                        {label}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {wu.role}
                        {enrolled
                          ? ` · enrolled ${wu.mfaEnrolledAt!.toISOString().slice(0, 10)}`
                          : " · not enrolled"}
                      </p>
                    </div>
                    <MfaToggle
                      practiceUserId={wu.id}
                      enrolled={enrolled}
                      userLabel={label}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Phishing drills */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Mail className="h-4 w-4" aria-hidden="true" />
              Phishing drills
            </h2>
            <PhishingDrillForm />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Industry baseline: click rate &lt;10%, report rate &gt;20%. Run
            at least every 6 months. Many cyber insurance carriers now
            require this as a baseline control.
          </p>
          {recentDrills.length === 0 ? (
            <p className="text-xs text-muted-foreground">No drills logged yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {recentDrills.map((d) => {
                const click = d.totalRecipients > 0 ? d.clickedCount / d.totalRecipients : 0;
                const report = d.totalRecipients > 0 ? d.reportedCount / d.totalRecipients : 0;
                const goodClick = click <= 0.1;
                return (
                  <li key={d.id} className="space-y-1 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular-nums">
                        {d.conductedAt.toISOString().slice(0, 10)}
                      </span>
                      {d.vendor && (
                        <Badge variant="secondary" className="text-[10px]">
                          {d.vendor}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="text-[10px] tabular-nums"
                        style={{
                          color: goodClick
                            ? "var(--gw-color-compliant)"
                            : "var(--gw-color-risk)",
                          borderColor: goodClick
                            ? "var(--gw-color-compliant)"
                            : "var(--gw-color-risk)",
                        }}
                      >
                        Click: {Math.round(click * 100)}%
                      </Badge>
                      <Badge variant="outline" className="text-[10px] tabular-nums">
                        Report: {Math.round(report * 100)}%
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {d.totalRecipients} recipients
                      </span>
                    </div>
                    {d.notes && (
                      <p className="text-[10px] text-muted-foreground">{d.notes}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Backup verification */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Database className="h-4 w-4" aria-hidden="true" />
              Backup restore-tests
            </h2>
            <BackupVerificationForm />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Per the OCR Ransomware Fact Sheet, untested backups are not
            backups. Run at minimum quarterly for the EHR; many practices
            test monthly for high-value systems.
          </p>
          {recentBackups.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tests logged yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {recentBackups.map((b) => (
                <li key={b.id} className="space-y-1 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">
                      {b.verifiedAt.toISOString().slice(0, 10)}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {b.scope}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                      style={{
                        color: b.success
                          ? "var(--gw-color-compliant)"
                          : "var(--gw-color-risk)",
                        borderColor: b.success
                          ? "var(--gw-color-compliant)"
                          : "var(--gw-color-risk)",
                      }}
                    >
                      {b.success ? "Successful" : "Failed"}
                    </Badge>
                    {b.restoreTimeMinutes !== null && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {b.restoreTimeMinutes} min
                      </span>
                    )}
                  </div>
                  {b.notes && (
                    <p className="text-[10px] text-muted-foreground">{b.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Encryption shortcut */}
      <Card>
        <CardContent className="flex items-start gap-3 p-5">
          <Lock className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="flex-1 space-y-1">
            <h2 className="text-sm font-semibold">PHI asset encryption</h2>
            <p className="text-[11px] text-muted-foreground">
              {snapshot.encryptedPhiAssetCount}/{snapshot.totalPhiAssetCount}{" "}
              PHI-processing asset(s) encrypted (full-disk or field-level).
              Manage at{" "}
              <Link
                href={"/programs/security-assets" as Route}
                className="text-foreground underline hover:no-underline"
              >
                /programs/security-assets
              </Link>
              .
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
