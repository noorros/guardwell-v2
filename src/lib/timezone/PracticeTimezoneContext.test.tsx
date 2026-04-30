// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PracticeTimezoneProvider,
  usePracticeTimezone,
} from "./PracticeTimezoneContext";

function Probe() {
  const tz = usePracticeTimezone();
  return <span data-testid="tz">{tz}</span>;
}

describe("PracticeTimezoneProvider", () => {
  it("provides the tz to descendants via the hook", () => {
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <Probe />
      </PracticeTimezoneProvider>,
    );
    expect(screen.getByTestId("tz").textContent).toBe("America/Phoenix");
  });

  it("falls back to UTC when no provider is mounted", () => {
    render(<Probe />);
    expect(screen.getByTestId("tz").textContent).toBe("UTC");
  });
});
