// src/app/(dashboard)/programs/training/[courseId]/CourseRunner.test.tsx
//
// Phase 4 PR 6 — DOM regression for the quiz unlock gate. Mocks the
// inner VideoLessonPlayer + QuizRunner so the test focuses purely on
// the wrapper's gating logic.

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { CourseRunner } from "./CourseRunner";

let lastOnProgressChange: ((pct: number) => void) | null = null;

vi.mock("@/components/gw/VideoLessonPlayer", () => ({
  VideoLessonPlayer: (props: {
    onProgressChange?: (pct: number) => void;
  }) => {
    lastOnProgressChange = props.onProgressChange ?? null;
    return <div data-testid="video-player-mock" />;
  },
}));

vi.mock("./QuizRunner", () => ({
  QuizRunner: () => <div data-testid="quiz-runner-mock" />,
}));

beforeEach(() => {
  lastOnProgressChange = null;
});

describe("<CourseRunner>", () => {
  it("renders the quiz immediately when the course has no video", () => {
    render(
      <CourseRunner
        courseId="c1"
        passingScore={80}
        questions={[]}
        videoSrc={null}
        videoDurationSec={0}
        initialWatchedSeconds={0}
      />,
    );
    expect(screen.queryByTestId("video-player-mock")).not.toBeInTheDocument();
    expect(screen.getByTestId("quiz-runner-mock")).toBeInTheDocument();
  });

  it("locks the quiz when the user has watched < 80% of the video", () => {
    render(
      <CourseRunner
        courseId="c1"
        passingScore={80}
        questions={[]}
        videoSrc="/x"
        videoDurationSec={100}
        initialWatchedSeconds={50}
      />,
    );
    expect(screen.getByTestId("video-player-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("quiz-runner-mock")).not.toBeInTheDocument();
    // Lock copy mentions the threshold
    expect(screen.getByText(/unlocks once you've watched/i)).toBeInTheDocument();
  });

  it("renders the quiz when server-known progress is already >= 80%", () => {
    render(
      <CourseRunner
        courseId="c1"
        passingScore={80}
        questions={[]}
        videoSrc="/x"
        videoDurationSec={100}
        initialWatchedSeconds={80}
      />,
    );
    // Both shown — video at top, quiz unlocked.
    expect(screen.getByTestId("video-player-mock")).toBeInTheDocument();
    expect(screen.getByTestId("quiz-runner-mock")).toBeInTheDocument();
  });

  it("unlocks the quiz live when onProgressChange surfaces >= 80", () => {
    render(
      <CourseRunner
        courseId="c1"
        passingScore={80}
        questions={[]}
        videoSrc="/x"
        videoDurationSec={100}
        initialWatchedSeconds={0}
      />,
    );
    expect(screen.queryByTestId("quiz-runner-mock")).not.toBeInTheDocument();
    // Simulate the player calling onProgressChange(80)
    act(() => {
      lastOnProgressChange?.(80);
    });
    expect(screen.getByTestId("quiz-runner-mock")).toBeInTheDocument();
  });

  it("treats videoSrc set + videoDurationSec=0 as no video (renders quiz immediately)", () => {
    // Defensive: if a course was authored with videoUrl but durationSec
    // 0, we don't strand the user behind a gate they can never pass.
    render(
      <CourseRunner
        courseId="c1"
        passingScore={80}
        questions={[]}
        videoSrc="/x"
        videoDurationSec={0}
        initialWatchedSeconds={0}
      />,
    );
    expect(screen.queryByTestId("video-player-mock")).not.toBeInTheDocument();
    expect(screen.getByTestId("quiz-runner-mock")).toBeInTheDocument();
  });
});
