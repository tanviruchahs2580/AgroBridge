/**
 * Local design-review capture: signs in as the seeded demo farmer and writes a
 * full-page screenshot per route to `design-review/`. Run against the running dev
 * stack (web :5173 + API :4000). Screenshots are for review only and are not
 * committed (design-review/ is gitignored).
 *
 *   node scripts/capture-design-review.mjs            # 390x844, light
 *   node scripts/capture-design-review.mjs --dark     # dark theme
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "design-review");
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const DARK = process.argv.includes("--dark");
const THEME = DARK ? "dark" : "light";

const ROUTES = [
  ["home", "/"],
  ["farm", "/farm"],
  ["market", "/market"],
  ["services", "/services"],
  ["sell", "/sell"],
  ["wallet", "/wallet"],
  ["orders", "/orders"],
  ["notifications", "/notifications"],
  ["advisor", "/advisor"],
  ["settings", "/settings"],
  ["onboarding", "/onboarding"],
  ["privacy", "/privacy"],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "bn-BD",
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

await page.goto(`${BASE}/login`);
await page.fill("#phone", "01700000002");
await page.fill("#password", "Demo@1234");
await page.click('button:has-text("প্রবেশ করুন")');
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20_000 });

if (DARK) {
  await page.goto(`${BASE}/`);
  await page.locator("header button[aria-pressed]").first().click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
}

for (const [name, path] of ROUTES) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("domcontentloaded");
  // Let data settle and entrance animations finish (they are 0.5 s + stagger).
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, `${name}-${THEME}.png`), fullPage: true });
  console.log(`captured ${name} (${path}) -> design-review/${name}-${THEME}.png`);
}

await browser.close();
console.log(`done — screenshots in ${OUT}`);
