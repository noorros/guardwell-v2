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
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          setupFiles: ["./tests/setup-jsdom.ts"],
          include: ["src/components/**/*.test.{ts,tsx}"],
          globals: false,
        },
      },
    ],
  },
});
