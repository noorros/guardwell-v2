// src/app/(dashboard)/programs/track/page.tsx
import Link from "next/link";
import type { Route } from "next";
import { Compass } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { ScoreRing } from "@/components/gw/ScoreRing";
import { EmptyState } from "@/components/gw/EmptyState";
import { generateTrackIfMissing } from "@/lib/events/projections/track";
import { TrackTaskRow } from "./TrackTaskRow";

export const metadata = { title: "Get started · My Programs" };
export const dynamic = "force-dynamic";

const WEEK_LABELS: Record<number, string> = {
  1: "Week 1 — Designate + adopt",
  2: "Week 2 — Policies + training",
  4: "Week 4 — Risk + credentials",
  8: "Week 8 — Practice the response",
  12: "Week 12 — Lock in the cadence",
};

export default async function TrackPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  let track = await db.practiceTrack.findUnique({
    where: { practiceId: pu.practiceId },
    include: {
      tasks: {
        orderBy: [{ weekTarget: "asc" }, { sortOrder: "asc" }],
      },
    },
  });

  // Backfill path: practice may have a compliance profile from before the
  // Track feature shipped (the profile projection didn't generate a track
  // historically). If a profile exists, lazy-generate the track on first
  // page load. If no profile, send the user to onboarding to fill it out.
  if (!track) {
    const profile = await db.practiceComplianceProfile.findUnique({
      where: { practiceId: pu.practiceId },
      select: { practiceId: true },
    });
    if (!profile) {
      redirect("/onboarding/compliance-profile" as Route);
    }
    await db.$transaction(async (tx) => {
      await generateTrackIfMissing(tx, pu.practiceId, pu.dbUser.id);
    });
    track = await db.practiceTrack.findUnique({
      where: { practiceId: pu.practiceId },
      include: {
        tasks: {
          orderBy: [{ weekTarget: "asc" }, { sortOrder: "asc" }],
        },
      },
    });
    if (!track) {
      // Should never happen — generateTrackIfMissing returned without
      // creating a row. Surface as 500 rather than redirect-loop.
      throw new Error("Failed to generate Compliance Track");
    }
  }

  const total = track.tasks.length;
  const done = track.tasks.filter((t) => t.completedAt !== null).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const grouped = new Map<number, typeof track.tasks>();
  for (const t of track.tasks) {
    const arr = grouped.get(t.weekTarget) ?? [];
    arr.push(t);
    grouped.set(t.weekTarget, arr);
  }
  const weeks = [...grouped.keys()].sort((a, b) => a - b);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb
        items={[{ label: "My Programs" }, { label: "Get started" }]}
      />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Compass className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Get started</h1>
          <p className="text-sm text-muted-foreground">
            A 12-week roadmap built for your practice. Tasks tagged{" "}
            <span className="mx-0.5 rounded border px-1 text-[10px]">
              auto-completes
            </span>{" "}
            tick off when the underlying compliance work happens; the rest
            need an explicit Mark done click.
          </p>
        </div>
        <ScoreRing score={pct} size={64} strokeWidth={7} assessed />
      </header>

      {track.completedAt && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold text-[color:var(--gw-color-compliant)]">
              ✓ Track complete
            </p>
            <p className="text-xs text-muted-foreground">
              Every task is closed. Review the audit overview to start a
              quarterly cadence —{" "}
              <Link
                href={"/audit/overview" as Route}
                className="underline"
              >
                /audit/overview
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {weeks.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No tasks yet"
          description="The track is empty for your specialty template. Contact support."
        />
      ) : (
        weeks.map((week) => {
          const tasks = grouped.get(week)!;
          const weekDone = tasks.filter((t) => t.completedAt !== null).length;
          return (
            <section key={week} className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {WEEK_LABELS[week] ?? `Week ${week}`}
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  {weekDone} / {tasks.length} done
                </span>
              </div>
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <TrackTaskRow
                    key={t.id}
                    taskId={t.id}
                    title={t.title}
                    description={t.description}
                    href={t.href}
                    requirementCode={t.requirementCode}
                    completedAt={t.completedAt?.toISOString() ?? null}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </main>
  );
}
