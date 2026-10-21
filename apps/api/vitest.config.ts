import { defineConfig } from "vitest/config";

/**
 * Measured with `npx vitest run --coverage` (SQLite profile, full suite, v8):
 *   statements 80.05 | branches 67.76 | functions 78.57 | lines 80.05
 * Thresholds sit ~5 points below those numbers so the gate catches
 * regressions without blocking current work.
 *
 * Note: branches measure 67.76 — marginally under the 70% aspiration — because
 * the remaining credential-gated provider adapters (providers/payment/*,
 * providers/storage/*, weather/openweather.ts) run nowhere outside production.
 * Raise the branches floor to 70 once those adapters get adapter-level unit
 * coverage or are moved behind a runtime-injected interface. ai/openai-compat.ts
 * is no longer excluded: tests/ai-provider-adapter.test.ts stubs globalThis.fetch
 * and covers the adapter's success path and full typed failure taxonomy offline.
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
        statements: 75,
        branches: 63,
        functions: 73,
        lines: 75,
      },
    },
  },
});
