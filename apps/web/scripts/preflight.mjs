#!/usr/bin/env node
/**
 * Web release preflight — the checks that must hold for what we actually serve.
 *
 * Runs after `npm run build` (CI: the web-quality job's build step; locally the
 * same commands). Five families, each one a trap that fails *silently* in
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
 * 4. **Raw hex in the token layer.** Colors must come from `tokens.css` /
 *    `dark.css` so the dark theme and the AA contrast work stay enforceable in
 *    one place. A literal that slips into a component renders fine in light mode
 *    and is invisible to every other check (and to axe) — see the allowlist
 *    below for the one site the browser itself forces.
 * 5. **Dead Tailwind classes.** A class that does not exist in
 *    `tailwind.config.js` emits no rule at all, so the element renders unstyled
 *    while lint, typecheck, unit tests, E2E and axe all stay green. Three such
 *    classes shipped at HEAD and were found by the 2026-10-22 audit:
 *    `bg-surface-card-subdued` (the token is spelled `surface.subdued`),
 *    `bg-warning` (the `warning` group has no DEFAULT key) and
 *    `decoration-link/40` (a bare `var(--color-*)` cannot take an opacity
 *    modifier). Scanner: scripts/lib/dead-classes.mjs.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { builtCssPath, findDeadClasses } from "./lib/dead-classes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const WEB = join(HERE, ".."); // apps/web
const ROOT = join(WEB, "..", ".."); // repo root

const BUDGETS = [
  // 2026-10-19 (WEB-01): measured 130.6 kB gz after the eager framer-motion
  // renderers moved to `m` + one LazyMotion(domAnimation) at the root; the full
  // motion component (gestures/layout) now rides only the lazy /services chunk.
  // The audit proposed ≤130 — the measurement is 0.6 kB above that, and a 130
  // limit would fail the build it was meant to lock in, so the gate is 132.
  { what: "entry bundle (gzip)", limitKb: 132, of: () => gzipKbOf(entryChunk()) },
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

// ── 5. every color in the app comes from the token layer ───────────────────
// Hex belongs in tokens.css / dark.css only: the dark theme re-points those
// variables, so a literal in a component silently opts out of dark mode and
// out of the AA contrast work. CSS files are out of scope here (they *are* the
// token layer) — but `.ts(x)` cannot ship a raw #rrggbb without being named
// below with a reason.
//
// Allowlist — browser-forced literals only, each with its justification comment
// in the source. Keep it empty by preferring a token; adding an entry is a
// design decision, not a quick fix.
const HEX_ALLOWLIST = [
  // <meta name="theme-color"> is read before any stylesheet resolves, so the
  // only correct value is a literal (session.tsx applyTheme).
  { file: "src/lib/session.tsx", reason: "meta theme-color literal — var() is not resolved for it" },
];
const HEX_RE = /#[0-9a-fA-F]{6}\b/;
function tsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = tsFiles(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
const srcDir = join(WEB, "src");
const hexOffenders = [];
const hexAllowed = [];
for (const file of tsFiles(srcDir)) {
  const rel = relative(WEB, file).split(sep).join("/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const allowed = HEX_ALLOWLIST.find((a) => a.file === rel);
  lines.forEach((text, i) => {
    if (!HEX_RE.test(text)) return;
    const hit = `${rel}:${i + 1} ${text.trim().slice(0, 100)}`;
    if (allowed) hexAllowed.push(`${hit} — allowed: ${allowed.reason}`);
    else hexOffenders.push(hit);
  });
}
if (hexOffenders.length) {
  fail(
    `raw hex color(s) outside the token layer (${hexOffenders.length}):\n     ` +
      hexOffenders.join("\n     ") +
      `\n     use a token from src/tokens.css (add one there if it does not exist) ` +
      `or add the file to HEX_ALLOWLIST in this script with a reason`
  );
} else {
  pass(`no raw hex colors in src/**/*.ts(x) outside the token layer (${hexAllowed.length} allowlisted)`);
}
for (const a of hexAllowed) console.log(`  ↳ ${a}`);

// ── 5. Dead Tailwind classes ────────────────────────────────────────────────
// Checked against the compiled stylesheet, not the source: the source cannot say
// whether a class resolved, and every other gate passes while the element is
// unstyled.
const cssPath = builtCssPath(join(WEB, "dist", "assets"));
if (!cssPath) {
  fail("no stylesheet in dist/assets — the dead-class check needs a build");
} else {
  const { checked, dead } = findDeadClasses({ cssText: readFileSync(cssPath, "utf8"), srcDir: join(WEB, "src") });
  if (dead.length) {
    fail(
      `Tailwind class(es) that emit no CSS (${dead.length} of ${checked} checked):\n     ` +
        dead.map((d) => `${d.cls} — ${d.files.join(", ")}`).join("\n     ") +
        `\n     a class the config does not define renders unstyled; check the token name in ` +
        `tailwind.config.js, and remember a bare var(--color-*) cannot take an /opacity modifier`
    );
  } else {
    pass(`every Tailwind class in src/ resolves in the built CSS (${checked} checked)`);
  }
}

if (failures.length) {
  console.error(`\n✗ web preflight FAILED (${failures.length} problem${failures.length === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log("\n✓ web preflight passed");
