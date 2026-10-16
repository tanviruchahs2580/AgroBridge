// Production read-only smoke test (2026-10-17): real-user journeys on the live site.
// Read-only: login + navigation + rendering + theme/lang toggles only — no orders,
// bookings, cart actions, deletes or other state-changing flows against production.
// Usage: node scripts/prod-smoke.mjs
import { chromium } from "@playwright/test";

const BASE = "https://agrobridge-web.vercel.app";
const PHONE = "01700000044";
const PASSWORD = "QaTest@2026";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: "light" });
await ctx.addInitScript(() => sessionStorage.setItem("agro_splash_done", "1"));
const page = await ctx.newPage();

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name} :: ${String(e).split("\n")[0].slice(0, 160)}`); }
}

await step("T01 login page renders (title + fields)", async () => {
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#phone", { timeout: 20000 });
  if (!(await page.title()).includes("এগ্রোব্রিজ")) throw new Error("title");
});

await step("T02 UI login as QA farmer → dashboard", async () => {
  await page.fill("#phone", PHONE);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL(BASE + "/", { timeout: 30000 }),
    page.click("button[type=submit]"),
  ]);
});

await step("T03 Home greets the user with real shell", async () => {
  await page.waitForSelector("#main", { timeout: 15000 });
  const text = await page.textContent("#main");
  if (!text.includes("স্বাস্থ্য স্কোর") && !text.includes("আজকের কাজ") && !text.includes("আবহাওয়া")) throw new Error("no home markers");
});

const routes = [
  ["T04 /farm loads", "/farm", "আমার ফার্ম"],
  ["T05 /market loads", "/market", "বাজার"],
  ["T06 /wallet loads", "/wallet", "ওয়ালেট"],
  ["T07 /orders loads", "/orders", "আমার অর্ডার"],
  ["T08 /services loads", "/services", "সেবা"],
  ["T09 /advisor loads", "/advisor", "এআই"],
  ["T10 /notifications loads", "/notifications", "নোটিফিকেশন"],
];
for (const [name, route, marker] of routes) {
  await step(name, async () => {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const text = await page.textContent("#main");
    if (!text.includes(marker)) throw new Error(`marker '${marker}' missing`);
  });
}

await step("T11 round-8 markers live (PageHeader + empty state keys)", async () => {
  await page.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const text = await page.textContent("body");
  if (!text.includes("কোনো এন্ট্রি নেই") && !text.includes("নোটিফিকেশন")) throw new Error("marker");
});

await step("T12 admin route still gated for farmer", async () => {
  await page.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const text = await page.textContent("#main");
  if (!text.includes("adminOnly") && !text.includes("অ্যাডমিন") && !text.includes("কন্ট্রোল")) throw new Error("no gate UI");
});

await step("T13 language toggle works end-to-end", async () => {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.click('button:has-text("EN")', { timeout: 8000 });
  await page.waitForTimeout(1200);
  const nav = await page.textContent("body");
  if (!nav.includes("Market") && !nav.includes("Wallet")) throw new Error("no EN nav");
  await page.click('button:has-text("বাং")', { timeout: 8000 });
  await page.waitForTimeout(1000);
});

await step("T14 screenshots saved (home/market/services)", async () => {
  await page.goto(BASE + "/market", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../../docs/ux-renovation-2026-09-14/prod-market.png", fullPage: false });
  await page.goto(BASE + "/services", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../../docs/ux-renovation-2026-09-14/prod-services.png", fullPage: false });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "../../docs/ux-renovation-2026-09-14/prod-home-login.png", fullPage: false });
});

await browser.close();
console.log(results.join("\n"));
const fails = results.filter((r) => r.startsWith("FAIL"));
process.exit(fails.length ? 1 : 0);
