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

/**
 * Wait until the signed-in route has actually rendered, then read it.
 *
 * `#main` exists as soon as the shell paints, but every page is a lazy chunk, so
 * reading its text immediately returns an empty string — which is exactly how T03
 * reported "no home markers" against a Home page that renders them correctly
 * (measured: `#main` text length 0 at read time, 886 three seconds later). Poll for
 * content instead of racing the chunk, so a failure here means the page is wrong
 * rather than that the network was slow.
 */
async function mainText(page, { minLength = 120, timeout = 20000 } = {}) {
  const deadline = Date.now() + timeout;
  let text = "";
  while (Date.now() < deadline) {
    text = (await page.textContent("#main").catch(() => "")) ?? "";
    if (text.trim().length >= minLength) return text;
    await page.waitForTimeout(250);
  }
  throw new Error(`#main still nearly empty after ${timeout}ms (got ${text.trim().length} chars)`);
}

await step("T03 Home greets the user with real shell", async () => {
  await page.waitForSelector("#main", { timeout: 15000 });
  // Markers must be strings the page actually renders. "স্বাস্থ্য স্কোর" was one of
  // these until the hero was renamed to "খামার প্রস্তুতি"; it still matched nothing
  // in the source, so it silently counted as a failure while T03 raced the chunk.
  const text = await mainText(page);
  if (!text.includes("খামার প্রস্তুতি") && !text.includes("আজকের কাজ") && !text.includes("আবহাওয়া"))
    throw new Error("no home markers");
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
  const text = await mainText(page, { minLength: 10 });
  // The gate copy is what the route actually renders for a non-admin
  // (`t("adminOnly")`). The previous markers — the literal string "adminOnly" (a
  // dictionary KEY, never rendered) and "অ্যাডমিন"/"কন্ট্রোল" (words that appear
  // only in the ADMIN panel, not in the denial) — could not match this page at the
  // baseline commit either, so this step reported a broken gate that was working.
  if (
    !text.includes("অনুমতি নেই") &&
    !text.includes("don't have permission") &&
    !text.includes("do not have permission")
  )
    throw new Error(`no gate UI (got: ${text.replace(/\s+/g, " ").slice(0, 120)})`);
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
