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
 * The branches ceiling is the credential-gated provider adapters
 * (providers/payment/*, providers/storage/*, weather/openweather.ts) that run
 * nowhere outside production — live-gateway behaviour is now exercised by
 * tests/payments-reconciliation-amount.test.ts against a stubbed fetch, which
 * is why branches cleared 70 on this measurement. Raise the floors as those
 * adapters get contract-replay coverage.
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
        // Credential-gated / environment-dependent provider adapters — not wired in CI
        "src/providers/payment/sandbox.ts",
        "src/providers/payment/sslcommerz.ts",
        "src/providers/payment/types.ts",
        "src/providers/storage/s3.ts",
        "src/providers/storage/types.ts",
        "src/providers/weather/openweather.ts",
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
