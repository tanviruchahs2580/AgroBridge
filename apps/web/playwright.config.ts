import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  /**
   * Assertion budget, deliberately above Playwright's 5 s default.
   *
   * Every screen is a lazy chunk and most read the API, so "the element is visible"
   * is gated on a route chunk plus a round trip — and this suite saturates the one
   * API instance it runs against (see `workers: 1` below). At 5 s that produced
   * failures which were not about the UI: a dark-mode axe scan died at its sign-in
   * step because the shell was still hydrating (the same test passed alone in 22 s,
   * and the whole file then passed 5/5 on re-run), and two webkit settings tests
   * timed out looking for `#st-name` after five earlier specs had warmed the load.
   *
   * No assertion and no threshold changes — a genuinely missing element still fails,
   * just after 10 s instead of 5. It removes a class of false red that CI was
   * already absorbing with `retries: 2`.
   */
  expect: { timeout: 10_000 },
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
  /**
   * CI-only retry budget (local runs still fail fast). Each of these two
   * failures happened once, on identical content, inside otherwise-green runs:
   * webkit's journey timed out on the post-login navigation (PR #54's
   * post-merge run) and chromium's axe scan of the signed-in routes (PR #60).
   * A single jittered step in a 42-spec, 5-browser, single-worker suite was
   * turning false reds on main at retry-unaware odds; two retries keep a
   * genuine regression red while absorbing the observed one-off class.
   */
  retries: process.env.CI ? 2 : 0,
  // html for the artifact CI uploads on failure; traces are retained on
  // failure, which with a CI retry budget means a spec that fails all
  // attempts still comes out diagnosable.
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
    // Cross-engine smoke (Firefox, WebKit). Both run the same two journeys the
    // Play-Store review exercises; the full suite stays on chromium only — a
    // second and third full pass would add runner minutes, not signal, for a
    // suite whose failures so far were layout logic rather than engine quirks.
    // Viewport matches the chromium project so a smoke failure means the engine
    // differs, not the layout.
    {
      name: "firefox",
      testMatch: ["**/farmer-journey.spec.ts", "**/settings-account.spec.ts"],
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 390, height: 844 },
        locale: "bn-BD",
      },
    },
    {
      name: "webkit",
      testMatch: ["**/farmer-journey.spec.ts", "**/settings-account.spec.ts"],
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 390, height: 844 },
        locale: "bn-BD",
      },
    },
  ],
  // When PLAYWRIGHT_BASE_URL is set the caller owns the server (CI's second,
  // production-build pass points it at the `vite preview` instance on :4173).
  // Starting the dev server in that case would be wrong twice over: the URL is
  // not the dev server's, and the two servers would contend for nothing.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --port 5173 --strictPort",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
