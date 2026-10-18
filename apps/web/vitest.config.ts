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
    // Floors sit ~5 points below those numbers (same policy as
    // apps/api/vitest.config.ts): they catch regressions without blocking
    // current work on the large untested feature surfaces (src/features/*).
    // Raise them as feature-level tests land.
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/**/*.stories.{ts,tsx}"],
      thresholds: {
        statements: 13,
        branches: 72,
        functions: 46,
        lines: 13,
      },
    },
  },
});
