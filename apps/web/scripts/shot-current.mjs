// Quick ad-hoc screenshot of arbitrary routes → WIP folder.
// Usage: node scripts/shot-current.mjs "<name1>=<route1>" "<name2>=<route2>" ...
import { chromium } from "@playwright/test";
const specs = process.argv.slice(2).map((s) => { const [name, route] = s.split("="); return { name, route }; });
const browser = await chromium.launch();
for (const [w, h, tag, scheme] of [[390, 844, "m", "light"], [1280, 800, "d", "light"], [390, 844, "m-dark", "dark"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.addInitScript(() => sessionStorage.setItem("agro_splash_done", "1"));
  const page = await ctx.newPage();
  if (!specs[0].route.startsWith("/login") && !specs[0].route.startsWith("/register")) {
    await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click("button[type=submit]");
    await page.waitForURL("http://localhost:5173/", { timeout: 20000 });
  }
  for (const { name, route } of specs) {
    await page.goto("http://localhost:5173" + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `../../docs/ux-renovation-2026-09-14/wip-${tag}-${name}.png`, fullPage: true });
    console.log("shot", `${tag}-${name}`);
  }
  await ctx.close();
}
await browser.close();
