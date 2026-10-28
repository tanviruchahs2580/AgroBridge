#!/usr/bin/env node
/**
 * Route matrix generator (API-01 / ARC-11 / SEC-03).
 *
 * Parses the mounted API surface from source (the modules' route files) and emits
 * a committed inventory: method, mounted path, and the authorization middleware in
 * the route's chain. `--check` exits 1 when the committed inventory no longer
 * matches what the source produces (drift guard).
 *
 * Source-parsing (not runtime introspection) is deliberate: the inventory must
 * reflect what the SHIPPED source mounts, independent of any test bootstrap.
 *
 * Auth-scope model the parser encodes:
 *  - explicit per-route `requireAuth` / `requirePermission(...)` in the chain;
 *  - `<router>.use(requireAuth)` at file level applies to every route declared on
 *    that router symbol, and propagates to sub-router factories mounted from an
 *    authed parent (`farmsRouter.use("/:id", eventsRouter())`, fixed-point);
 *  - otherwise the route is PUBLIC (rate-limited and validated, unauthenticated
 *    by design — e.g. the payments webhook verifies provider signatures itself).
 * The guard test asserts the PUBLIC set never grows beyond the admission allowlist.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulesDir = path.join(apiRoot, "src", "modules");
const OUT_JSON = path.join(apiRoot, "..", "..", "docs", "generated", "route-matrix.json");
const OUT_MD = path.join(apiRoot, "..", "..", "docs", "generated", "route-matrix.md");
const CHECK = process.argv.includes("--check");

/** Route-declaring files. module = the domain used for grouping in the matrix. */
const ROUTE_FILES = [
  ["auth", "auth/routes.ts"],
  ["admin", "admin/routes.ts"],
  ["aiagent", "aiagent/routes.ts"],
  ["analytics", "analytics/routes.ts"],
  ["disease", "disease/routes.ts"],
  ["farms", "farms/routes.ts"],
  ["marketplace", "marketplace/routes.ts"],
  ["notifications", "notifications/routes.ts"],
  ["ops", "ops/routes.ts"],
  ["organizations", "organizations/routes.ts"],
  ["payments", "payments/routes.ts"],
  ["payments-webhook", "payments/webhook.ts"],
  ["procurement", "procurement/routes.ts"],
  ["services", "services/routes.ts"],
  ["weather", "weather/routes.ts"],
];

const HTTP = "(get|post|patch|put|delete)";

function sliceCall(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return text.slice(openIdx, openIdx + 400);
}

function firstPathArg(args) {
  const m = /^\s*[`'"]([^`'"]+)[`'"]/.exec(args);
  return m ? m[1] : null;
}

function authChainOf(args) {
  const chain = [];
  if (/requireAuth/.test(args)) chain.push("requireAuth");
  const perm = /requirePermission\(\s*["'`]([\w:.~-]+)["'`]\s*\)/.exec(args);
  if (perm) chain.push(`requirePermission:${perm[1]}`);
  return chain;
}

const routes = [];

for (const [module, file] of ROUTE_FILES) {
  const full = path.join(modulesDir, file);
  const text = readFileSync(full, "utf8");

  // Pass 1: which router symbols have file-level `use(requireAuth)`.
  const authedBySymbol = new Set();
  for (const m of text.matchAll(/(\w+)\.use\(\s*requireAuth\s*,?\s*\)/g)) authedBySymbol.add(m[1]);

  // Pass 1b: sub-router factory functions (`export function eventsRouter() { … }`)
  // declare their routes on a LOCAL `router` symbol — map route positions to the
  // enclosing factory name so pass 3 can give them the parent's auth scope.
  const factorySpans = [];
  for (const m of text.matchAll(/export function (\w*[Rr]outer)\(\)/g)) {
    const start = m.index;
    let depth = 0;
    let opened = false;
    let end = text.length;
    for (let i = text.indexOf("{", m.index); i < text.length; i++) {
      if (text[i] === "{") { depth++; opened = true; }
      else if (text[i] === "}") {
        depth--;
        if (opened && depth === 0) { end = i; break; }
      }
    }
    factorySpans.push({ name: m[1], start, end });
  }
  const factoryAt = (idx) => factorySpans.find((f) => idx >= f.start && idx <= f.end)?.name ?? null;

  // Pass 2 routes: symbol (enclosing factory name when inside one), method, path,
  // direct auth chain.
  const found = [];
  const moduleRe = new RegExp(`\\b\\w*[Rr]outer\\b\\.${HTTP}\\(`, "g");
  for (const m of text.matchAll(moduleRe)) {
    const method = m[1].toUpperCase();
    const args = sliceCall(text, m.index + m[0].length - 1);
    const routePath = firstPathArg(args);
    if (!routePath) continue;
    const routerSym = factoryAt(m.index) ?? (/^\s*(\w+)/.exec(text.slice(m.index))?.[1] ?? "unknown");
    found.push({ symbol: routerSym, method, path: routePath, chain: authChainOf(args) });
  }

  // Pass 2b: fluent chains. A factory may build its router as one expression —
  // `return Router({ mergeParams: true }).post("/plots", …).get("/plots", …)` —
  // so those declarations hang off no identifier and pass 2 cannot see them.
  // The dot of a fluent call is never preceded by an identifier, which is what
  // separates this pass from the symbol-based one above.
  for (const f of factorySpans) {
    const body = text.slice(f.start, f.end);
    for (const m of body.matchAll(/(?:^|[^\w$.])\.(get|post|patch|put|delete)\(\s*[`'"]/gm)) {
      const openParen = f.start + m.index + m[0].lastIndexOf("(");
      const args = sliceCall(text, openParen);
      const routePath = firstPathArg(args);
      if (!routePath) continue;
      found.push({ symbol: f.name, method: m[1].toUpperCase(), path: routePath, chain: authChainOf(args) });
    }
  }

  // Pass 3: sub-router factories mounted from an authed parent inherit its scope
  // (fixed-point so chains of factories settle too).
  const mountRe = /(\w+)\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*(\w+)\(\s*\)\s*\)/g;
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of text.matchAll(mountRe)) {
      const parent = m[1];
      const child = m[3];
      if (authedBySymbol.has(parent) && !authedBySymbol.has(child)) {
        authedBySymbol.add(child);
        changed = true;
      }
    }
  }

  for (const r of found) {
    let auth;
    if (r.chain.length > 0) auth = r.chain.join(",");
    else if (authedBySymbol.has(r.symbol)) auth = `requireAuth (file-level use on ${r.symbol})`;
    else auth = "PUBLIC";
    routes.push({ module, file: `src/modules/${file}`, method: r.method, path: r.path, router: r.symbol, auth });
  }
}

routes.sort((a, b) => (a.module + a.path + a.method).localeCompare(b.module + b.path + a.method));

const summary = routes.reduce((acc, r) => {
  const key = r.auth.startsWith("PUBLIC") ? "PUBLIC" : r.auth.split(",")[0];
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

const payload = {
  generatedFrom: "src/modules/**/routes.ts",
  total: routes.length,
  summary,
  routes,
};

const md = [
  "# Route inventory (generated — do not edit by hand)",
  "",
  "Regenerate with `node apps/api/scripts/route-matrix.mjs`; drift fails `tests/route-matrix.test.ts`",
  "and the `quality-gates` CI job. `auth` values: `requireAuth`, `requirePermission:<scope>`,",
  "`requireAuth (file-level use on …)` (module declares `router.use(requireAuth)` for that router),",
  "or `PUBLIC` (rate-limited and validated, but unauthenticated by design — see docs/api.md).",
  "",
  `Total: ${routes.length} routes. Summary: ${JSON.stringify(summary)}`,
  "",
  "| module | method | path | auth |",
  "|---|---|---|---|",
  ...routes.map((r) => `| ${r.module} | ${r.method} | ${r.path} | ${r.auth} |`),
  "",
].join("\n");

if (CHECK) {
  const committedJson = readFileSync(OUT_JSON, "utf8");
  const committedMd = readFileSync(OUT_MD, "utf8");
  if (committedJson !== JSON.stringify(payload, null, 2) + "\n" || committedMd !== md) {
    console.error("route matrix drift — regenerate: node apps/api/scripts/route-matrix.mjs");
    process.exit(1);
  }
  console.log(`route matrix up to date (${routes.length} routes)`);
} else {
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + "\n");
  writeFileSync(OUT_MD, md);
  console.log(`route matrix written: ${OUT_JSON} (${routes.length} routes)`);
}
