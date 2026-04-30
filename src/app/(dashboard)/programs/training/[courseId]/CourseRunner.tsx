// src/app/(dashboard)/programs/training/[courseId]/CourseRunner.tsx
//
// Phase 4 PR 6 — client wrapper that lifts the QuizRunner unlock gate
// out of the server [courseId]/page.tsx. When the course has a video,
// we render the VideoLessonPlayer at top and only reveal the
// QuizRunner once watch progress reaches >= 80% — either from
// server-known progress (initialPct) or live as the player ticks.
//
// When the course has NO video, this component is effectively a
// pass-through that renders only the QuizRunner — kept symmetric so
// the page.tsx integration is one branch instead of two.

"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { VideoLessonPlayer } from "@/components/gw/VideoLessonPlayer";
import { QuizRunner, type QuizQuestion } from "./QuizRunner";

export interface CourseRunnerProps {
  courseId: string;
  passingScore: number;
  questions: QuizQuestion[];
  /** When set, the video player is rendered and the quiz is gated
   *  behind 80% watched. Null = no video, quiz is always available. */
  videoSrc: string | null;
  videoDurationSec: number;
  /** Server-known watched progress, used for the initial unlock state
   *  so a returning user doesn't have to re-watch to see the quiz. */
  initialWatchedSeconds: number;
}

const UNLOCK_THRESHOLD_PCT = 80;

function pctOf(watched: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((watched / duration) * 100)));
}

export function CourseRunner({
  courseId,
  passingScore,
  questions,
  videoSrc,
  videoDurationSec,
  initialWatchedSeconds,
}: CourseRunnerProps) {
  // No video → quiz always shown. Single source of truth for the gate.
  const hasVideo = videoSrc != null && videoDurationSec > 0;
  const initialPct = hasVideo
    ? pctOf(initialWatchedSeconds, videoDurationSec)
    : 100;

  const [progressPct, setProgressPct] = useState<number>(initialPct);

  // Monotonically non-decreasing — match the projection's MAX-merge
  // semantic. The VideoLessonPlayer fires onProgressChange whenever
  // its internal pct changes, INCLUDING decreases (user scrubs back,
  // or the very first timeUpdate fires at currentTime=0 before
  // loadedmetadata sets the resume position). Without Math.max here,
  // a returning user with serverPct=90 would briefly drop to 0 and
  // re-lock the gate. See CourseRunner.test.tsx regression case.
  const handleProgress = (next: number) => {
    setProgressPct((prev) => Math.max(prev, next));
  };

  const isUnlocked =
    !hasVideo || progressPct >= UNLOCK_THRESHOLD_PCT;

  return (
    <div className="space-y-6">
      {hasVideo && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-base font-semibold">Video lesson</h2>
            <VideoLessonPlayer
              courseId={courseId}
              videoSrc={videoSrc}
              videoDurationSec={videoDurationSec}
              initialWatchedSeconds={initialWatchedSeconds}
              onProgressChange={handleProgress}
            />
            {!isUnlocked && (
              <p className="text-xs text-muted-foreground">
                Watch at least {UNLOCK_THRESHOLD_PCT}% of the video to unlock
                the quiz. ({progressPct}% so far)
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {isUnlocked ? (
        <QuizRunner
          courseId={courseId}
          passingScore={passingScore}
          questions={questions}
        />
      ) : (
        <Card aria-disabled="true">
          <CardContent className="space-y-2 p-6">
            <h2 className="text-lg font-semibold">Quiz</h2>
            <p className="text-sm text-muted-foreground">
              The quiz unlocks once you&apos;ve watched at least{" "}
              {UNLOCK_THRESHOLD_PCT}% of the video lesson above.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
