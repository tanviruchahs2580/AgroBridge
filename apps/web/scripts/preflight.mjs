#!/usr/bin/env node
/**
 * Web release preflight — the checks that must hold for what we actually serve.
 *
 * Runs after `npm run build` (CI: the web-quality job's build step; locally the
 * same commands). Three families, each one a trap that fails *silently* in
 * production if nothing checks it:
 *
 * 1. **CSP ↔ inline script.** `index.html` carries a deliberately inline
 *    theme-boot script — an external file would be a render-blocking round trip
 *    before first paint on exactly the slow connections this app targets — so the
 *    CSP allowlists that script by SHA-256 hash. Edit the script without updating
 *    the hash and the browser blocks it: the app still works, the theme just
 *    flashes on every reload. This recomputes the hash from the **built** HTML
 *    (not the source, which the bundler could rewrite) and checks both Vercel
 *    configs.
 * 2. **CSP ↔ API origin.** `connect-src` names the API hosts explicitly. Point
 *    `VITE_API_BASE_URL` somewhere else without adding that origin and every API
 *    call is blocked in production — while working perfectly in dev, where no CSP
 *    header is served.
 * 3. **Performance budget.** Deterministic byte budgets for the shipped payload.
 *    The repo's Lighthouse config is `workflow_dispatch`-only, so nothing else
 *    would notice a bundle or font regression like the four duplicate Noto files
 *    this pass removed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const WEB = join(HERE, ".."); // apps/web
const ROOT = join(WEB, "..", ".."); // repo root

const BUDGETS = [
  { what: "entry bundle (gzip)", limitKb: 150, of: () => gzipKbOf(entryChunk()) },
  { what: "all JS (gzip)", limitKb: 225, of: () => sumGzipKb("assets", /\.js$/) },
  { what: "all CSS (gzip)", limitKb: 15, of: () => sumGzipKb("assets", /\.css$/) },
  { what: "fonts", limitKb: 520, of: () => sumKb("fonts") },
  { what: "images", limitKb: 2600, of: () => sumKb("images") },
];

const failures = [];
function fail(msg) {
  failures.push(msg);
  console.error(`✗ ${msg}`);
}
function pass(msg) {
  console.log(`✓ ${msg}`);
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function headerMap(config, source) {
  const rule = (config.headers ?? []).find((h) => h.source === source);
  return new Map((rule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

const distHtml = join(WEB, "dist", "index.html");
if (!existsSync(distHtml)) {
  console.error("✗ dist/index.html is missing — run `npm run build` before the preflight");
  process.exit(1);
}

const rootConfig = readJson(join(ROOT, "vercel.json"));
const webConfig = readJson(join(WEB, "vercel.json"));

// ── 1. the two Vercel configs cannot drift apart ────────────────────────────
// Git deploys read the repo-root config (the project's root directory is the repo
// root); the documented CLI flow (`cd apps/web && vercel deploy --prod`) reads the
// other one. Same posture on both paths or neither is trustworthy.
const rootHeaders = JSON.stringify(rootConfig.headers ?? null);
const webHeaders = JSON.stringify(webConfig.headers ?? null);
if (rootHeaders !== webHeaders) {
  fail("vercel.json header sets differ between the repo root and apps/web — one deploy path would ship a weaker policy");
} else {
  pass("both vercel.json files carry the same header policy");
}

// ── 2. every inline script in the built HTML is allowlisted by hash ─────────
const html = readFileSync(distHtml, "utf8");
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const csp = headerMap(rootConfig, "/(.*)").get("content-security-policy") ?? "";
const scriptSrc = (csp.match(/script-src ([^;]+)/)?.[1] ?? "").trim();

// The hash is over the exact bytes the browser receives, so a CRLF working tree
// hashes differently from the LF tree Vercel builds — the hash that passes here
// would then block the script in production, and only a theme flash would show
// it. `.gitattributes` forces `eol=lf`; this is the tripwire that says so out
// loud when a checkout predates that (or somebody overrides it).
const carriageReturns = inlineScripts.filter((body) => body.includes("\r"));
if (carriageReturns.length) {
  fail(
    `${carriageReturns.length} inline script(s) in dist/index.html contain CR bytes — this checkout has CRLF ` +
      `line endings, so its hash cannot match the LF bytes Vercel builds. Re-checkout with the repository's ` +
      `.gitattributes (\`eol=lf\`) in effect: \`git rm --cached -r . && git reset --hard\``
  );
}

if (!csp) {
  fail("no Content-Security-Policy for /(.*) in vercel.json");
} else if (scriptSrc.includes("'unsafe-inline'")) {
  fail("script-src allows 'unsafe-inline' — inline scripts must be allowlisted by hash");
} else {
  for (const body of inlineScripts) {
    const hash = `sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`;
    if (scriptSrc.includes(hash)) {
      pass(`inline script (${Buffer.byteLength(body, "utf8")} bytes) is allowlisted: ${hash}`);
    } else {
      fail(
        `an inline script in the built index.html is NOT allowlisted by the CSP — it would be blocked in production.\n` +
          `     expected in script-src: ${hash}\n` +
          `     script-src currently: ${scriptSrc}\n` +
          `     (update vercel.json in the repo root AND apps/web)`
      );
    }
  }
  if (inlineScripts.length === 0) pass("no inline scripts in the built HTML (script-src 'self' is sufficient)");
}

// ── 3. the API origin the bundle actually uses is allowed by connect-src ────
const connectSrc = (csp.match(/connect-src ([^;]+)/)?.[1] ?? "").trim();
const envProd = join(WEB, ".env.production");
if (!existsSync(envProd)) {
  fail("apps/web/.env.production is missing — the API origin cannot be verified against the CSP");
} else {
  const apiBase = readFileSync(envProd, "utf8").match(/^VITE_API_BASE_URL=(.+)$/m)?.[1]?.trim();
  if (!apiBase) {
    fail("VITE_API_BASE_URL is not set in apps/web/.env.production");
  } else {
    const origin = new URL(apiBase).origin;
    if (connectSrc.split(/\s+/).includes(origin)) {
      pass(`connect-src allows the API origin the bundle bakes in (${origin})`);
    } else {
      fail(
        `connect-src does not allow ${origin}, the API origin in apps/web/.env.production — ` +
          `every API call would be blocked in production (connect-src: ${connectSrc})`
      );
    }
  }
}

// ── 4. performance budget ──────────────────────────────────────────────────
function walk(dir, out = []) {
  const full = join(WEB, "dist", dir);
  if (!existsSync(full)) return out;
  for (const entry of readdirSync(full)) {
    const p = join(full, entry);
    if (statSync(p).isDirectory()) walk(join(dir, entry), out);
    else out.push(p);
  }
  return out;
}
function sumKb(dir) {
  return walk(dir).reduce((n, p) => n + statSync(p).size, 0) / 1024;
}
function sumGzipKb(dir, re) {
  return walk(dir).filter((p) => re.test(p)).reduce((n, p) => n + gzipSync(readFileSync(p), { level: 9 }).length, 0) / 1024;
}
function entryChunk() {
  const html = readFileSync(distHtml, "utf8");
  const src = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
  if (!src) throw new Error("entry chunk not found in dist/index.html");
  return join(WEB, "dist", "assets", src);
}
function gzipKbOf(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length / 1024;
}

for (const b of BUDGETS) {
  const actual = b.of();
  const line = `${b.what}: ${actual.toFixed(1)} kB (budget ${b.limitKb} kB)`;
  if (actual > b.limitKb) fail(`${line} — over budget`);
  else pass(line);
}

if (failures.length) {
  console.error(`\n✗ web preflight FAILED (${failures.length} problem${failures.length === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log("\n✓ web preflight passed");
