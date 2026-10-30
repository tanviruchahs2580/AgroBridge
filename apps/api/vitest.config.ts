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
 * AUD-205: `payment/sandbox.ts` (the default provider in every test) and
 * `payment/sslcommerz.ts` (exercised by payments-reconciliation-amount against
 * a stubbed fetch) used to sit in the exclude list with an outdated "not wired
 * in CI" note — a critical-path denominator that shrank while the gates stayed
 * green. Both are instrumented now; re-measure and raise the floors when they
 * move. Remaining exclusions are deliberate and owner-visible: the type-only
 * modules (no executable lines) and the two genuinely credential-gated
 * adapters with no replay coverage yet (storage/s3.ts, weather/openweather.ts).
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
        // Type-only modules (no executable lines) and the credential-gated
        // adapters without replay coverage (see AUD-205 note above).
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
