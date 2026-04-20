// jsdom test setup. Extends Vitest's expect with @testing-library/jest-dom
// matchers (toBeInTheDocument, toHaveAccessibleName, etc.) and registers
// jest-axe's toHaveNoViolations matcher for a11y assertions.

import "@testing-library/jest-dom/vitest";
import { expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

afterEach(() => {
  cleanup();
});
