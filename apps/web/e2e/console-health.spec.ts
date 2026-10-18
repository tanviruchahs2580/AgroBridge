import { test, expect } from "@playwright/test";

/**
 * Console health (E-07).
 *
 * A route can render "fine" while leaking console errors, uncaught exceptions
 * or failed requests — exactly the regressions a screenshot/visibility check
 * never sees. This spec signs in once, walks the eight critical pages plus one
 * form-error path, and requires all three channels to stay clean:
 *   - console entries of type "error"
 *   - uncaught page errors (pageerror)
 *   - failed network requests (requestfailed)
 *
 * Requires the running stack (API :4000 + web :5173; see farmer-journey.spec.ts)
 * and the seeded demo farmer 01700000002 / Demo@1234 — one sign-in per test to
 * stay under the API's 20 logins / 15 min / IP limit.
 */

const PAGES = [
  { name: "login", path: "/login", auth: false },
  { name: "register", path: "/register", auth: false },
  { name: "home", path: "/", auth: true },
  { name: "farm", path: "/farm", auth: true },
  { name: "market", path: "/market", auth: true },
  { name: "services", path: "/services", auth: true },
  { name: "notifications", path: "/notifications", auth: true },
  // /admin is deliberately NOT swept here: a non-admin visit probes five admin
  // endpoints and every one is refused with 403 (the panel then renders its
  // page-level denied state, asserted by admin-guard.spec.ts). Chromium logs
  // each deliberate refusal as a console error, so sweeping it would need a
  // pattern broad enough to also mask real 403s on the other routes.
] as const;

type Captured = { kind: "console" | "pageerror" | "requestfailed"; text: string };

/**
 * Known-benign entries only — every entry needs a reason it cannot indicate an
 * app defect. Anything suppressed by this list is printed in the test output
 * (see the report at the end), so a suppression can never go unnoticed.
 */
const ALLOWLIST: { pattern: RegExp; why: string }[] = [
  {
    pattern: /Download the React DevTools/,
    why: "React's own dev-build hint; ships in no production bundle (and no production console).",
  },
  {
    pattern: /\[vite\]/,
    why: "Vite dev-server transport chatter (HMR websocket); has no production analogue.",
  },
  {
    pattern: /net::ERR_ABORTED/,
    why: "Navigation cancels in-flight fetches (stale resource loads, deferred chunks); Chromium reports the aborted request as failed even though nothing broke.",
  },
];

function benignExclusion(text: string): string | null {
  for (const { pattern } of ALLOWLIST) if (pattern.test(text)) return pattern.source;
  return null;
}

async function seededLogin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#phone", "01700000002");
  await page.fill("#password", "Demo@1234");
  await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 15_000 });
}

test("no console errors, page errors or failed requests on the critical routes + a form-error path", async ({ page }) => {
  test.slow(); // 8 page loads + form interactions + one sign-in
  const captured: Captured[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") captured.push({ kind: "console", text: msg.text() });
  });
  page.on("pageerror", (err) => captured.push({ kind: "pageerror", text: err.message }));
  page.on("requestfailed", (req) =>
    captured.push({ kind: "requestfailed", text: `${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "unknown"}` })
  );

  // Public pages first (the reverse guard bounces them once signed in).
  for (const p of PAGES.filter((x) => !x.auth)) {
    await page.goto(p.path);
    await page.waitForLoadState("networkidle");
  }

  // Form-error path 1 — client-side validation: an empty submit must render
  // inline errors (and must not raise console noise while doing so).
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.click('button[type="submit"]');
  await expect(page.locator('p[role="alert"]').first(), "empty submit rendered no inline validation error").toBeVisible();

  // Form-error path 2 — server-side rejection: wrong password surfaces the
  // mapped error banner (a real 401 round-trip through mapError).
  await page.fill("#phone", "01700000002");
  await page.fill("#password", "DefinitelyWrong1");
  await page.click('button[type="submit"]');
  await expect(page.locator("body"), "wrong-password path showed no user-visible error").toContainText(
    /পাসওয়ার্ড|password|সঠিক নয়/i
  );

  // Signed-in routes (the failed attempt above does not create a session).
  await seededLogin(page);
  for (const p of PAGES.filter((x) => x.auth)) {
    await page.goto(p.path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#main"), `${p.path}: main landmark missing`).toBeVisible();
    // Give late effects (toasts, focus handling, telemetry) a beat to run.
    await page.waitForTimeout(400);
  }

  // Report every suppression with its reason — visible in the Playwright output.
  const suppressed = captured.filter((c) => benignExclusion(c.text) !== null);
  if (suppressed.length > 0) {
    console.log(`[console-health] suppressed ${suppressed.length} known-benign entr(ies):`);
    for (const s of suppressed) console.log(`  [${s.kind}] ${s.text.slice(0, 200)}`);
  }

  const offenders = captured.filter((c) => benignExclusion(c.text) === null);
  expect(
    offenders,
    `console health violations (${offenders.length}):\n` + offenders.map((o) => `  [${o.kind}] ${o.text}`).join("\n")
  ).toEqual([]);
});
