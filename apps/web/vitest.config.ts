import { defineConfig } from "vitest/config";

// Unit tests only — Playwright specs under e2e/ run via `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    // Coverage gate (E-03). Scope is the application source only: without an
    // explicit `include`, v8 also counts generated Android web assets
    // (android/app/src/main/assets/public/**) and config files, which drags the
    // measured percentage down for no signal. Test files are excluded by vitest.
    //
    // Measured on the current suite (2026-10-18, local, v8, 136/136 tests):
    //   statements 18.49 | branches 77.20 | functions 51.51 | lines 18.49
    // Floors sit just below measured (2 points) so a real regression fails but
    // refactors do not. Measured 2026-10-24 on vitest 4 (its v8 remapping
    // counts branches far more granularly than vitest 3 did — the absolute
    // numbers moved with the toolchain, the suite did not): statements 42.66,
    // branches 32.37, functions 38.08, lines 44.12. The weakest tier remains
    // src/features/* — the AUD-V3 wave added orders/wallet/sell-crop; raise
    // the floors as more feature suites land.
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/**/*.stories.{ts,tsx}"],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 36,
        lines: 42,
      },
    },
  },
});
