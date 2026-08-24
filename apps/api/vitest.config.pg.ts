import { defineConfig } from "vitest/config";

/** PostgreSQL test profile: database must be provisioned beforehand (see docs/testing.md). */
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 45_000,
    include: ["tests/**/*.test.ts"],
  },
});
