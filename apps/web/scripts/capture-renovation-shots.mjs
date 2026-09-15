// Capture light/dark, mobile/desktop screenshots of all routes for the
// UI/UX renovation before/after report. Usage:
//   node scripts/capture-renovation-shots.mjs <outputDir> [baseUrl]
// Requires the web dev server (default http://localhost:5173) and API (:4000).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? "shots");
const base = process.argv[3] ?? "http://localhost:5173";
mkdirSync(outDir, { recursive: true });

const FARMER = { phone: "01700000002", password: "Demo@1234" };
const ADMIN = { phone: "01700000000", password: "Demo@1234" };

const AUTHED_ROUTES = [
  ["/", "home"],
  ["/farm", "farm"],
  ["/advisor", "advisor"],
  ["/market", "market"],
  ["/services", "services"],
  ["/sell", "sell"],
  ["/wallet", "wallet"],
  ["/orders", "orders"],
  ["/notifications", "notifications"],
  ["/onboarding", "onboarding"],
];

async function newPage(browser, { viewport, colorScheme }) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: "bn-BD",
    colorScheme,
  });
  // Suppress the 2.8s splash overlay so shots capture real content.
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("agro_splash_done", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function login(page, { phone, password }) {
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.fill("#phone", phone);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(base + "/", { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}

async function shot(page, route, name) {
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200); // let lazy chunks + fetches settle
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  console.log("captured", name);
}

const browser = await chromium.launch();
try {
  // Mobile farmer (primary UX): light
  const m = await newPage(browser, { viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await login(m.page, FARMER);
  for (const [route, name] of AUTHED_ROUTES) await shot(m.page, route, `m-light-${name}`);
  await m.page.goto(base + "/login", { waitUntil: "networkidle" }).catch(() => {});
  // logout to capture logged-out screens
  await m.page.evaluate(() => localStorage.clear());
  await shot(m.page, "/register", "m-light-register");
  await shot(m.page, "/login", "m-light-login");
  await m.ctx.close();

  // Mobile farmer: dark
  const d = await newPage(browser, { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await login(d.page, FARMER);
  for (const route of ["/", "/market", "/wallet"]) {
    const name = `m-dark-${route === "/" ? "home" : route.slice(1)}`;
    await shot(d.page, route, name);
  }
  await d.ctx.close();

  // Desktop farmer: light
  const dt = await newPage(browser, { viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  await login(dt.page, FARMER);
  for (const [route, name] of [
    ["/", "d-light-home"],
    ["/market", "d-light-market"],
    ["/services", "d-light-services"],
  ])
    await shot(dt.page, route, name);
  await dt.ctx.close();

  // Admin panel (needs admin role)
  const a = await newPage(browser, { viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await login(a.page, ADMIN);
  await shot(a.page, "/admin", "m-light-admin");
  await a.ctx.close();
} finally {
  await browser.close();
}
console.log("DONE →", outDir);
