import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // All tests run in Node environment:
    // - unit tests are pure TypeScript (no DOM)
    // - integration/E2E tests spawn child processes
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
