import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Fake-timer suites freeze p-throttle's clock, so a real per-second cap deadlocks them.
    env: {
      PASEO_GIT_MAX_PROCESSES_PER_SECOND: "10000",
    },
    testTimeout: 120_000,
    hookTimeout: 120_000,
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "./src/test-utils/vitest-setup.ts")],
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    // The Forgejo runner kills idle forked workers between suites; every test
    // still passes, so do not fail the job on those pool lifecycle errors.
    dangerouslyIgnoreUnhandledErrors: true,
    fileParallelism: false,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/.dev/**"],
  },
});
