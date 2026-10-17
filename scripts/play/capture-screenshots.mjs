#!/usr/bin/env node
/**
 * Captures the Google Play phone screenshots from the REAL running app.
 *
 *   node scripts/play/capture-screenshots.mjs
 *   # optional: PLAYWRIGHT_BASE_URL, AGRO_PHONE, AGRO_PASSWORD, AGRO_LANG
 *
 * Screenshots are taken at a 9:16 phone viewport (360x640 CSS px at DPR 3 =
 * 1080x1920 px), which satisfies Play's "2-8 phone screenshots, min 320 px,
 * aspect between 16:9 and 9:16" requirement, and are shot live so the store
 * listing shows the shipped UI rather than a mock-up.
 *
 * Requires the local stack: API on :4000 and the web app on :5173 (see
 * docs/play/release-runbook.md step 1).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const PHONE = process.env.AGRO_PHONE ?? "01700000002";
const PASSWORD = process.env.AGRO_PASSWORD ?? "Demo@1234";
const LANG = process.env.AGRO_LANG ?? "bn";
const OUT = path.resolve("play/screenshots");

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: LANG === "bn" ? "bn-BD" : "en-US",
  colorScheme: "light",
});
const page = await ctx.newPage();

/** Waits for the app to settle: skeletons gone, no in-flight requests. */
async function settle(ms = 1200) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

async function shot(name, { fullPage = false } = {}) {
  await page.waitForTimeout(400);
  // JPEG q88: Play accepts JPEG or 24-bit PNG for screenshots, and ten phone
  // screens as PNG were 4.4 MB in the repository for no visible gain.
  const file = path.join(OUT, `phone-${name}.jpg`);
  await page.screenshot({ path: file, fullPage, type: "jpeg", quality: 88 });
  const { size } = fs.statSync(file);
  console.log(`✓ ${path.relative(process.cwd(), file)} (${Math.round(size / 1024)} kB)`);
}

async function gotoRoute(route) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await settle();
}

console.log(`capturing from ${BASE} as ${PHONE} (${LANG})`);

// ── Login screen (unauthenticated) ──
await ctx.clearCookies();
await gotoRoute("/login");
await shot("01-login");

// ── Sign in ──
await page.locator("#phone").fill(PHONE);
await page.locator("#password").fill(PASSWORD);
await page.getByRole("button", { name: /প্রবেশ|লগইন|Sign in|Login/i }).first().click();
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20000 }).catch(() => {});
await settle(2000);

const routes = [
  ["/", "02-home"],
  ["/farm", "03-my-farm"],
  ["/advisor", "04-ai-agent"],
  ["/market", "05-market"],
  ["/services", "06-services"],
  ["/wallet", "07-wallet"],
  ["/settings", "08-settings"],
];

for (const [route, name] of routes) {
  await gotoRoute(route);
  // Settings and My Farm are longer than one screen; capture the viewport so the
  // listing shows what a phone actually shows.
  await shot(name);
}

// ── Public legal pages (also prove they render without a session) ──
await ctx.clearCookies();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
for (const [route, name] of [["/privacy", "09-privacy"], ["/account-deletion", "10-delete-account"]]) {
  await gotoRoute(route);
  await shot(name);
}

await browser.close();
console.log(`\n${fs.readdirSync(OUT).length} screenshots in ${path.relative(process.cwd(), OUT)}`);
