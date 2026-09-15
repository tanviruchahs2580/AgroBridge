import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    // 127.0.0.1, not localhost: on Windows `localhost` resolves to IPv6 ::1
    // first, so an unrelated IPv6 dev server could shadow ours (seen in QA
    // 2026-09-15 when e2e silently tested a different app on ::1:5173).
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "on-first-retry",
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
