// src/components/gw/VideoLessonPlayer/index.test.tsx
//
// Phase 4 PR 6 — DOM regression for the BYOV player. We mock
// reportVideoWatchedAction so the test is presentational; the action
// is exercised by tests/integration/training-actions.test.ts.

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { VideoLessonPlayer } from ".";

const reportMock = vi.fn();
vi.mock("@/app/(dashboard)/programs/training/actions", () => ({
  reportVideoWatchedAction: (...args: unknown[]) => reportMock(...args),
}));

beforeEach(() => {
  reportMock.mockReset();
  reportMock.mockResolvedValue({ ok: true });
});

/**
 * jsdom doesn't drive an actual <video> clock — currentTime is a plain
 * mutable property. We dispatch synthetic timeupdate events to exercise
 * the component's reporter.
 */
function tickTo(video: HTMLVideoElement, seconds: number) {
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    value: seconds,
  });
  fireEvent.timeUpdate(video);
}

describe("<VideoLessonPlayer>", () => {
  it("renders the <video> with the supplied src + a progress status", () => {
    render(
      <VideoLessonPlayer
        courseId="c1"
        videoSrc="/api/evidence/ev-1/download"
        videoDurationSec={600}
        initialWatchedSeconds={0}
      />,
    );
    const video = screen.getByLabelText(/training video lesson/i) as HTMLVideoElement;
    expect(video).toBeInTheDocument();
    expect(video.tagName).toBe("VIDEO");
    expect(video.getAttribute("src")).toBe("/api/evidence/ev-1/download");
    expect(screen.getByRole("status")).toHaveTextContent(/0% watched/i);
    expect(screen.getByRole("status")).toHaveTextContent(/10 min total/i);
  });

  it("reports progress when watched advances by >= 10 seconds, MAX-style high-water mark", () => {
    const onProgress = vi.fn();
    render(
      <VideoLessonPlayer
        courseId="c1"
        videoSrc="/x"
        videoDurationSec={600}
        initialWatchedSeconds={0}
        onProgressChange={onProgress}
      />,
    );
    const video = screen.getByLabelText(/training video lesson/i) as HTMLVideoElement;

    // 5s → no report (<10s since last)
    tickTo(video, 5);
    expect(reportMock).not.toHaveBeenCalled();

    // 12s → first report (12 - 0 >= 10)
    tickTo(video, 12);
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(reportMock).toHaveBeenLastCalledWith({
      courseId: "c1",
      watchedSeconds: 12,
    });

    // 15s → no NEW report (15 - 12 < 10)
    tickTo(video, 15);
    expect(reportMock).toHaveBeenCalledTimes(1);

    // 25s → second report (25 - 12 >= 10)
    tickTo(video, 25);
    expect(reportMock).toHaveBeenCalledTimes(2);
    expect(reportMock).toHaveBeenLastCalledWith({
      courseId: "c1",
      watchedSeconds: 25,
    });

    // 10s rewind (back to 15) → must NOT re-report (lastReported is 25)
    tickTo(video, 15);
    expect(reportMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces progressPct >= 80 once watched reaches 80% of duration", () => {
    const onProgress = vi.fn();
    render(
      <VideoLessonPlayer
        courseId="c1"
        videoSrc="/x"
        videoDurationSec={100}
        initialWatchedSeconds={0}
        onProgressChange={onProgress}
      />,
    );
    const video = screen.getByLabelText(/training video lesson/i) as HTMLVideoElement;
    // 80 / 100 = 80%
    tickTo(video, 80);
    // The setState + onProgressChange fire on this tick.
    const lastCall = onProgress.mock.calls.at(-1)![0] as number;
    expect(lastCall).toBeGreaterThanOrEqual(80);
    expect(screen.getByRole("status")).toHaveTextContent(/80% watched/i);
  });

  it("does NOT report when timeupdate fires but duration is 0 (defensive)", () => {
    render(
      <VideoLessonPlayer
        courseId="c1"
        videoSrc="/x"
        videoDurationSec={0}
        initialWatchedSeconds={0}
      />,
    );
    const video = screen.getByLabelText(/training video lesson/i) as HTMLVideoElement;
    tickTo(video, 50);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("computes initialWatchedSeconds-based pct on mount when no time has elapsed yet", () => {
    render(
      <VideoLessonPlayer
        courseId="c1"
        videoSrc="/x"
        videoDurationSec={100}
        initialWatchedSeconds={50}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/50% watched/i);
  });

  it("sends a final report on unmount when progress advanced past lastReported", async () => {
    const { unmount } = render(
      <VideoLessonPlayer
        courseId="c1"
        videoSrc="/x"
        videoDurationSec={100}
        initialWatchedSeconds={0}
      />,
    );
    const video = screen.getByLabelText(/training video lesson/i) as HTMLVideoElement;
    // Watch for 5 seconds — under the 10s reporter threshold.
    tickTo(video, 5);
    expect(reportMock).not.toHaveBeenCalled();
    // Unmount — the cleanup effect should flush a final report.
    await act(async () => {
      unmount();
    });
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(reportMock).toHaveBeenLastCalledWith({
      courseId: "c1",
      watchedSeconds: 5,
    });
  });

  it("axe-clean (default render)", async () => {
    const { container } = render(
      <VideoLessonPlayer
        courseId="c1"
        videoSrc="/x"
        videoDurationSec={600}
        initialWatchedSeconds={0}
      />,
    );
    // 'region' is disabled because the player is a fragment (no
    // landmark) — its parent page provides the <main>. 'video-caption'
    // is disabled because captions ship in a follow-up PR (PR 7+) —
    // BYOV launch lets the practice add their own caption track later.
    const results = await axe(container, {
      rules: {
        region: { enabled: false },
        "video-caption": { enabled: false },
      },
    });
    expect(results).toHaveNoViolations();
  }, 15_000);
});
