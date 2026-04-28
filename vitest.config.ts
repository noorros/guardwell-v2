import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    coverage: { provider: "v8", reporter: ["text", "html"] },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/**/*.test.ts", "src/lib/**/*.test.ts"],
          globals: false,
          // Integration tests share one Docker Postgres DB, so parallel
          // file execution races on cross-file FK/cleanup ordering. Each
          // file still runs tests in order with afterEach cleanup; we
          // just serialize between files.
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./tests/setup-jsdom.ts"],
          include: [
            "src/components/**/*.test.{ts,tsx}",
            "src/app/**/*.test.{ts,tsx}",
            // Next.js route-group dirs use parentheses — list any such
            // app-level test directories explicitly as a fallback so
            // vitest's glob engine always finds them regardless of OS
            // parenthesis-handling quirks.
            "src/app/(dashboard)/**/*.test.{ts,tsx}",
          ],
          globals: false,
        },
      },
    ],
  },
});
