// src/components/gw/VideoLessonPlayer/index.tsx
//
// Phase 4 PR 6 — BYOV video lesson player. Wraps a native HTML5 <video>
// with three behaviors specific to training:
//   1. Resume from saved position on mount (initialWatchedSeconds prop)
//   2. Report cumulative watchedSeconds every ~10 seconds of NEW
//      progress (rewinds and seeks-backward don't fire reports)
//   3. Surface a progressPct upward via onProgressChange so the parent
//      can gate the QuizRunner behind 80% watch
//
// Reports are fire-and-forget; the projection MAX-merges so a dropped
// network report just means the next successful one reconciles. The
// 10s cadence on a 1-hour video produces ~360 events per user per
// course — acceptable for v1 scale; could be batched to 60s if EventLog
// growth becomes an issue.

"use client";

import { useEffect, useRef, useState } from "react";
import { reportVideoWatchedAction } from "@/app/(dashboard)/programs/training/actions";

export interface VideoLessonPlayerProps {
  courseId: string;
  /** Resolved video URL. May be a /api/evidence/<id>/download path or a
   *  direct GCS signed URL. The component just hands it to <video src>. */
  videoSrc: string;
  videoDurationSec: number;
  initialWatchedSeconds: number;
  onProgressChange?: (pct: number) => void;
}

const REPORT_EVERY_SECONDS = 10;

function pctOf(watched: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((watched / duration) * 100)));
}

export function VideoLessonPlayer({
  courseId,
  videoSrc,
  videoDurationSec,
  initialWatchedSeconds,
  onProgressChange,
}: VideoLessonPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // The "high-water mark" of seconds we've already reported. Reports
  // only fire on NEW progress (current > lastReported + 10), so rewinds
  // never re-emit and the network is quiet during seek scrubbing.
  const lastReportedRef = useRef<number>(initialWatchedSeconds);
  const [pct, setPct] = useState<number>(
    pctOf(initialWatchedSeconds, videoDurationSec),
  );

  // Resume from saved position on mount.
  useEffect(() => {
    const v = videoRef.current;
    if (v && initialWatchedSeconds > 0) {
      // currentTime is a no-op until metadata loads. The
      // 'loadedmetadata' handler retries to cover that race.
      v.currentTime = initialWatchedSeconds;
    }
  }, [initialWatchedSeconds]);

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (v && initialWatchedSeconds > 0 && v.currentTime < initialWatchedSeconds) {
      v.currentTime = initialWatchedSeconds;
    }
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || videoDurationSec <= 0) return;

    const watched = Math.floor(v.currentTime);
    const newPct = pctOf(watched, videoDurationSec);
    if (newPct !== pct) {
      setPct(newPct);
      onProgressChange?.(newPct);
    }

    // Fire-and-forget every REPORT_EVERY_SECONDS seconds of NEW
    // progress (handles rewind: watched < lastReported is a no-op).
    if (watched - lastReportedRef.current >= REPORT_EVERY_SECONDS) {
      lastReportedRef.current = watched;
      void reportVideoWatchedAction({
        courseId,
        watchedSeconds: watched,
      }).catch(() => {
        // Silent — server-side state will reconcile on the next report.
      });
    }
  };

  // Final report on unmount/page-leave so a brief watch (<10s before
  // navigation) still records progress. Best-effort.
  useEffect(() => {
    const v = videoRef.current;
    return () => {
      if (!v || videoDurationSec <= 0) return;
      const watched = Math.floor(v.currentTime ?? 0);
      if (watched > lastReportedRef.current) {
        void reportVideoWatchedAction({
          courseId,
          watchedSeconds: watched,
        }).catch(() => {});
      }
    };
  }, [courseId, videoDurationSec]);

  const minutesTotal = Math.floor(videoDurationSec / 60);
  const totalLabel =
    videoDurationSec > 0
      ? minutesTotal > 0
        ? `${minutesTotal} min total`
        : `${videoDurationSec}s total`
      : "";

  return (
    <div className="space-y-2">
      <video
        ref={videoRef}
        src={videoSrc}
        controls
        preload="metadata"
        className="w-full rounded-lg bg-black"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        aria-label="Training video lesson"
      >
        Your browser does not support the video element.
      </video>
      <div
        role="status"
        aria-live="polite"
        className="text-xs text-muted-foreground"
      >
        Progress: {pct}% watched{totalLabel ? ` · ${totalLabel}` : ""}
      </div>
    </div>
  );
}
