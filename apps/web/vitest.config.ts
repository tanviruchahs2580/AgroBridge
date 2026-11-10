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
    // Floors are a ratchet: raise them as suites land, never lower them to pass.
    // Each raise sits a little below that run's measurement, so a real regression
    // fails while ordinary refactoring does not. Measurement history (local, v8):
    //   2026-10-18, 136 tests:      statements 18.49 | branches 77.20 | functions 51.51 | lines 18.49
    //   2026-10-24, vitest 4:       statements 42.66 | branches 32.37 | functions 38.08 | lines 44.12
    //     (vitest 4's v8 remapping counts branches far more granularly than
    //      vitest 3 did — the absolute numbers moved with the toolchain, not the suite)
    //   2026-11-10, 42 files / 275 tests (the F-29/F-39 wave: market pager,
    //     orders truncation, App shell, role-vocabulary guard, config invariants):
    //                               statements 66.92 | branches 55.43 | functions 64.69 | lines 69.41
    // The 2026-11-10 raise (40/30/36/42 → 64/52/62/66) is the one F-29 asked for:
    // the feature suites landed, so the floor moved up with them. Remaining 0%
    // files are src/features/home/Home.tsx and src/features/onboarding/Onboarding.tsx;
    // raise again when those land. Measured on Node 24 (the ambient runtime — the
    // project pins 22), which is why each floor keeps >2 points of headroom.
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/**/*.stories.{ts,tsx}"],
      thresholds: {
        statements: 64,
        branches: 52,
        functions: 62,
        lines: 66,
      },
    },
  },
});
