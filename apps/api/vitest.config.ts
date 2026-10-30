import { defineConfig } from "vitest/config";

/**
 * Measured with `npx vitest run --coverage` (SQLite profile, full suite, v8),
 * re-measured 2026-10-24 on vitest 4 (whose v8 remapping counts more
 * accurately — coverage rose from the 80.05/67.76/78.57/80.05 recorded on
 * vitest 3, helped by the AUD-V3 suites):
 *   statements 83.97 | branches 73.71 | functions 86.43 | lines 86.48
 * Thresholds sit 2 points below those numbers so a real regression fails but
 * refactors do not (the earlier ~5-point gap let the suite drift).
 *
 * AUD-205 + review follow-up: `payment/sandbox.ts`, `payment/sslcommerz.ts`,
 * `storage/s3.ts` (stub-server tests in adapter-failure-injection +
 * storage-serving-contract) and `weather/openweather.ts` (stubbed-fetch tests)
 * are all instrumented — each has a test that exercises it, and the earlier
 * "not wired in CI / no replay coverage" note was no longer true for any of
 * them. Re-measure and raise the floors when they move. The remaining
 * exclusions are type-only modules with no executable lines (payment/types.ts,
 * storage/types.ts); nothing else is excluded.
 */
export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./tests/global-setup.ts",
    setupFiles: ["./tests/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
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
        // Type-only modules (no executable lines) — the only remaining exclusions.
        "src/providers/payment/types.ts",
        "src/providers/storage/types.ts",
      ],
      thresholds: {
        statements: 82,
        branches: 72,
        functions: 84,
        lines: 84,
      },
    },
  },
});
