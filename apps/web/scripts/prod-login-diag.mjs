// Diagnostic: production UI login — capture network + console + state.
import { chromium } from "@playwright/test";
const BASE = "https://agrobridge-web-vantiq-systems.vercel.app";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => sessionStorage.setItem("agro_splash_done", "1"));
const page = await ctx.newPage();
page.on("response", (r) => { if (r.url().includes("/api/")) console.log("NET", r.status(), r.request().method(), r.url().slice(0, 110)); });
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR", m.text().slice(0, 140)); });
page.on("requestfailed", (r) => { if (r.url().includes("/api/")) console.log("REQFAIL", r.failure()?.errorText?.slice(0, 80), r.url().slice(0, 110)); });

await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#phone", { timeout: 20000 });
await page.fill("#phone", "01700000044");
await page.fill("#password", "QaTest@2026");
const btn = page.locator("button[type=submit]");
console.log("submit button count:", await btn.count());
console.log("btn enabled:", await btn.isEnabled().catch((e) => "ERR " + e.message.slice(0, 60)));
try {
  await Promise.all([
    page.waitForURL("**/", { timeout: 20000 }).then(() => console.log("NAVIGATED to", page.url())),
    btn.click({ timeout: 15000 }),
  ]);
} catch (e) {
  console.log("CLICK/NAV RESULT:", String(e).split("\n")[0].slice(0, 140));
}
await page.waitForTimeout(3000);
console.log("final url:", page.url());
console.log("localStorage keys:", await page.evaluate(() => Object.keys(localStorage).join(",")));
console.log("has token:", await page.evaluate(() => Boolean(localStorage.getItem("agro_access_token") || localStorage.getItem("agrobridge_access_token") || Object.keys(localStorage).some((k) => k.toLowerCase().includes("token")))));
await browser.close();
