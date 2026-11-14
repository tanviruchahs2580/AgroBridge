import { defineConfig } from "vitest/config";

/**
 * PostgreSQL test profile: database must be provisioned beforehand (see docs/testing.md).
 *
 * Coverage thresholds mirror the SQLite profile (vitest.config.ts) exactly —
 * the production engine must not be able to regress below the floor the dev
 * engine enforces. If one profile's measured coverage diverges, re-measure and
 * raise BOTH (ratchet: never lower to make a change pass).
 */
const coverageThresholds = {
  statements: 82,
  branches: 72,
  functions: 84,
  lines: 84,
} as const;

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 45_000,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "dist/**",
        "types/**",
        "coverage/**",
        // Type-only modules (no executable lines) — same exclusions as SQLite.
        "src/providers/payment/types.ts",
        "src/providers/storage/types.ts",
      ],
      thresholds: coverageThresholds,
    },
  },
});
