import { test, expect } from "@playwright/test";

/**
 * Logging out must end the session on the SERVER, not just in this browser.
 *
 * `POST /auth/logout` revokes only the refresh token it is handed in the request
 * body (`req.body.refreshToken`, optional). The web client used to send `{}`, so
 * the browser forgot its tokens and returned to /login while the server-side row
 * stayed valid for the token's full 7-day TTL — a refresh token copied earlier
 * (shared device, backup, XSS) kept minting access tokens after the user had
 * logged out. The API's own suite asserts the revocation contract
 * (apps/api/tests/security-matrix.test.ts); the client was not exercising it.
 *
 * This drives the real UI: sign in, press logout, capture the actual request body
 * the browser sent, then replay that refresh token against the API and require a
 * 401.
 */

test("logout through the UI revokes the refresh token server-side", async ({ page, request }) => {
  await page.goto("/login");
  await page.fill("#phone", "01700000002");
  await page.fill("#password", "Demo@1234");
  await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 15_000 });

  // Capture the logout request the UI itself issues.
  let logoutBody: Record<string, unknown> | null = null;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/auth/logout")) {
      try {
        logoutBody = req.postDataJSON() as Record<string, unknown>;
      } catch {
        logoutBody = null;
      }
    }
  });

  const logout = page.locator("header button", { hasText: /লগআউট|Logout/i }).first();
  await expect(logout).toBeVisible();
  await logout.click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });

  expect(logoutBody, "the UI never called POST /auth/logout").not.toBeNull();
  const refreshToken = String((logoutBody as Record<string, unknown>).refreshToken ?? "");
  expect(
    refreshToken.length,
    `logout sent no refresh token (body was ${JSON.stringify(logoutBody)}), so the server revoked nothing`
  ).toBeGreaterThan(20);

  // Replaying the revoked token must fail. A 200 here means logout left the
  // session alive on the server.
  const replay = await request.post("/api/v1/auth/refresh", { data: { refreshToken } });
  expect(replay.status(), "a refresh token survived logout and still mints access tokens").toBe(401);
});
