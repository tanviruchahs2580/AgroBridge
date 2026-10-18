import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  /**
   * One worker, deliberately. The specs are independent, but the backend they
   * drive is not: a single API process over a single SQLite file. Running specs
   * in parallel made a 2-vCPU CI runner contend for both — payment round-trips
   * exceeded the waits and later tests failed at sign-in with no relation to the
   * change under review (observed 2026-10-17, three "unrelated" failures). The
   * project had already learned this locally ("E2E 20/20 --workers=1"); the
   * config now says it instead of relying on whoever runs the command.
   * Revisit only when the suite gets its own per-worker database.
   */
  workers: 1,
  retries: 0,
  // list for the console, html for the artifact CI uploads on failure
  // (AUD-119: trace was "on-first-retry" while retries are 0, so no trace
  // could EVER be produced — a failing run left nothing to diagnose with).
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // 127.0.0.1, not localhost: on Windows `localhost` resolves to IPv6 ::1
    // first, so an unrelated IPv6 dev server could shadow ours (seen in QA
    // 2026-09-15 when e2e silently tested a different app on ::1:5173).
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
        locale: "bn-BD",
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
