import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const OUT = path.resolve("docs/screenshots");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "bn-BD",
});

const page = await ctx.newPage();

// helper: fullPage mobile screenshot
async function shot(name) {
  await page.waitForTimeout(700);
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log("captured", name);
}

// unauthenticated
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await shot("01-login-bn");

await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await shot("02-register-bn");

// login as farmer
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.locator("#phone").fill("01700000002");
await page.locator("#password").fill("Demo@1234");
await page.getByRole("button", { name: /প্রবেশ|Sign/i }).click();
await page.waitForURL("**/", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(900);
await shot("03-home-dashboard-bn");

// English toggle -> reshoot home
const enBtn = page.getByRole("button", { name: /English|EN/i });
if (await enBtn.count()) {
  await enBtn.first().click();
  await page.waitForTimeout(600);
  await shot("04-home-dashboard-en");
  // switch back to bn for remaining captures
  const bnBtn = page.getByRole("button", { name: /বাংলা|BN/i });
  if (await bnBtn.count()) { await bnBtn.first().click(); await page.waitForTimeout(500); }
}

// farmer pages
const farmerPages = [
  ["05-farm", "/farm"],
  ["06-advisor", "/advisor"],
  ["07-market", "/market"],
  ["08-sellcrop", "/sell"],
  ["09-services", "/services"],
  ["10-wallet", "/wallet"],
  ["11-notifications", "/notifications"],
];
for (const [name, url] of farmerPages) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await shot(name);
}

// on market trigger checkout wizard preview (open cart then checkout if possible)
try {
  await page.goto(`${BASE}/market`, { waitUntil: "networkidle" });
  // try to add first product to cart to populate wizard
  const addBtn = page.getByRole("button", { name: /কার্টে|Cart|যোগ করুন/i }).first();
  if (await addBtn.count()) { await addBtn.click(); await page.waitForTimeout(500); }
  const checkoutBtn = page.getByRole("button", { name: /চেকআউট|Checkout|অর্ডার/i }).first();
  if (await checkoutBtn.count()) { await checkoutBtn.click(); await page.waitForTimeout(700); await shot("07b-market-checkout-wizard"); }
} catch {}

// admin as ADMIN
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.locator("#phone").fill("01700000001");
await page.locator("#password").fill("Demo@1234");
await page.getByRole("button", { name: /প্রবেশ|Sign/i }).click();
await page.waitForURL("**/", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(900);
await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
await shot("12-admin");

await browser.close();
console.log("done", fs.readdirSync(OUT).join(", "));
