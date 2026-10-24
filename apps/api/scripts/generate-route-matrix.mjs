#!/usr/bin/env node
/**
 * Route × role matrix generator.
 *
 * Emits docs/route-role-matrix.md: every router mounted in src/app.ts, each of
 * its routes, and the guard that protects them — module-level `requireAuth`,
 * per-route `requireAuth`, or an entry in the explicit public allowlist below.
 *
 * Why static parsing instead of importing the app: the API is TypeScript and
 * this is a plain Node script (no tsx dependency in CI lint steps); importing
 * the app would also pull in the database/env gate, which must not run just to
 * print a table. The parser is deliberately narrow — it understands exactly the
 * registration shapes this codebase uses (`xRouter.use(requireAuth)`,
 * `xRouter.post("/path", mw, handler)`, `router.use("/:id", childRouter())`)
 * and FAILS LOUDLY on an unclassified route rather than guessing.
 *
 * The freshness gate in tests/route-role-matrix.test.ts regenerates the output
 * in memory and fails when the committed file differs byte-for-byte, so this
 * document cannot drift from the source.
 *
 * Usage:
 *   node apps/api/scripts/generate-route-matrix.mjs          # write the doc
 *   node apps/api/scripts/generate-route-matrix.mjs --check  # exit 1 on drift
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(API_DIR, "..", "..");

const APP_TS = resolve(API_DIR, "src/app.ts");
const RBAC_TS = resolve(API_DIR, "src/middleware/rbac.ts");
const OUT_MD = resolve(REPO_ROOT, "docs/route-role-matrix.md");

/**
 * Routes that are unauthenticated BY DESIGN. A route may only appear here with
 * a reason; anything unguarded and absent from this table makes the generator
 * fail, which is what keeps a forgotten `requireAuth` from silently shipping.
 */
export const PUBLIC_ROUTES = {
  "POST /auth/register":
    "account creation happens before any session exists; protected by the register limiter and schema validation, and duplicate phones get a neutral response (no enumeration oracle)",
  "POST /auth/login":
    "credential exchange itself; login limiter plus per-account throttle, uniform error and timing profile",
  "POST /auth/refresh":
    "the refresh token is the credential; rotation with reuse detection revokes the family",
  "POST /auth/password/forgot":
    "self-service recovery for a caller who cannot log in; always-200 response hides account existence",
  "POST /auth/password/reset":
    "completes recovery with the OTP issued by /auth/password/forgot; success revokes every refresh token",
  "POST /payments/webhook/sslcommerz":
    "gateway IPN; unauthenticated by contract and verified by the provider signature (constant-time) plus amount/currency checks",
  "ALL /payments/gateway/return/:outcome":
    "hosted-checkout browser return; trusts nothing in the request — the outcome is decided by asking the provider, the webhook remains the primary path",
  "GET /membership/plans":
    "public tier catalogue (price/benefits only, no user data); shown before login to drive sign-up",
  "GET /ops/retention":
    "scheduled-operations trigger for the platform cron; no session auth by design — guarded by the CRON_SECRET bearer (constant-time) and fail-closed when unset (AUD-V3)",
};

// ---------------------------------------------------------------------------
// Source scanning helpers
// ---------------------------------------------------------------------------

/** Skip over a quoted string / template literal starting at `i` (returns the index after its end). */
function skipString(src, i) {
  const quote = src[i];
  i += 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i += 1;
  }
  return i;
}

/**
 * Slice the argument list of the call whose "(" is at `open`, honoring strings
 * and comments so a paren inside a message or a URL cannot unbalance it.
 */
function sliceBalanced(src, open) {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i);
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i += 1;
  }
  throw new Error("unbalanced parentheses in route registration");
}

/** Split a call's argument text at top-level commas. */
function splitArgs(argsText) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < argsText.length) {
    const ch = argsText[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(argsText, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(argsText.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  parts.push(argsText.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i += 1) if (src[i] === "\n") line += 1;
  return line;
}

const ROUTE_METHODS = ["use", "get", "post", "patch", "put", "delete", "all"];
const CALL_RE = new RegExp(`(?<![\\w$.])([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${ROUTE_METHODS.join("|")})\\s*\\(`, "g");
const CHAIN_RE = new RegExp(`\\)\\s*\\.\\s*(${ROUTE_METHODS.join("|")})\\s*\\(`, "g");

/**
 * All `<ident>.<method>(...)` call sites in a file, with the callee text, the
 * method, the argument slices, and the source line.
 */
function callSites(src) {
  const sites = [];
  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(src))) {
    const open = m.index + m[0].length - 1;
    const argsText = sliceBalanced(src, open);
    sites.push({
      varName: m[1],
      method: m[2],
      open,
      dot: m.index + m[0].indexOf("."),
      args: splitArgs(argsText),
      line: lineOf(src, m.index),
    });
  }
  const knownDots = new Set(sites.map((s) => s.dot));
  CHAIN_RE.lastIndex = 0;
  while ((m = CHAIN_RE.exec(src))) {
    const dot = m.index + 1;
    if (knownDots.has(dot)) continue;
    const open = m.index + m[0].length - 1;
    const argsText = sliceBalanced(src, open);
    sites.push({
      varName: null, // continuation of a builder chain (e.g. Router().post(...))
      method: m[1],
      open,
      dot,
      args: splitArgs(argsText),
      line: lineOf(src, m.index),
    });
  }
  return sites.sort((a, b) => a.open - b.open);
}

/** String literal if the argument is one, else null. */
function stringLiteral(arg) {
  const m = /^"([^"]*)"$/.exec(arg);
  return m ? m[1] : null;
}

/** Function factory names like `plotsRouter()` used in `router.use(path, factory())`. */
function factoryCall(arg) {
  const m = /^([A-Za-z_$][\w$]*)\s*\(\s*\)$/.exec(arg);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Parsing the source model
// ---------------------------------------------------------------------------

/** Imported router identifiers in app.ts mapped to the module file that defines them. */
function parseModuleImports(appSrc) {
  const byIdent = new Map();
  const re = /import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(appSrc))) {
    const source = m[2];
    if (!source.startsWith("./modules/")) continue;
    const file = resolve(API_DIR, "src", source.replace(/^\.\//, "").replace(/\.js$/, ".ts"));
    for (const raw of m[1].split(",")) {
      const ident = raw.replace(/^\s*type\s+/, "").trim();
      if (ident) byIdent.set(ident, file);
    }
  }
  return byIdent;
}

/** `v1.use("/path", routerVar)` registrations, in source order (payments is mounted twice). */
function parseMounts(appSrc) {
  const mounts = [];
  const re = /v1\.use\(\s*"(\/[^"]+)"\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  let m;
  while ((m = re.exec(appSrc))) mounts.push({ path: m[1], routerVar: m[2], line: lineOf(appSrc, m.index) });
  return mounts;
}

/** Permission → roles, straight from middleware/rbac.ts (never retyped here). */
function parsePermissions() {
  const src = readFileSync(RBAC_TS, "utf8");
  const block = /export const PERMISSIONS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error("could not locate PERMISSIONS in src/middleware/rbac.ts");
  const byRole = [];
  const re = /([A-Z_]+)\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(block[1]))) {
    const permissions = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    byRole.push({ role: m[1], permissions });
  }
  if (!byRole.length) throw new Error("PERMISSIONS parsed empty — rbac.ts shape changed");
  return byRole;
}

function rolesForPermission(byRole, permission) {
  return byRole
    .filter((r) => r.permissions.includes("*") || r.permissions.includes(permission))
    .map((r) => r.role);
}

/**
 * Routes registered inside router factory functions (`export function
 * plotsRouter()` …) — the farms module nests three of these under the parent
 * router, so their paths are relative to the parent's mount.
 */
function factoryRoutes(src) {
  const functions = [...src.matchAll(/(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => ({ name: m[1], at: m.index }));
  const byFactory = new Map();
  for (const site of callSites(src)) {
    if (!["get", "post", "patch", "put", "delete", "all"].includes(site.method)) continue;
    const path = stringLiteral(site.args[0] ?? "");
    if (!path || !path.startsWith("/")) continue; // req.get("host") style false positives
    // Skip calls on the module's exported routers; those are handled separately.
    let owner = "(module scope)";
    for (const f of functions) if (f.at < site.open) owner = f.name;
    if (!byFactory.has(owner)) byFactory.set(owner, []);
    const list = byFactory.get(owner);
    const middlewareText = site.args.slice(1, -1).join(", ");
    const permission = /requirePermission\(\s*"([^"]+)"/.exec(middlewareText);
    if (!list.some((r) => r.method === site.method.toUpperCase() && r.path === path)) {
      list.push({ method: site.method.toUpperCase(), path, permission: permission ? permission[1] : null });
    }
  }
  return { byFactory, functions };
}

/** Exported (mounted) routers of one module file: guard + routes, in source order. */
function parseMountedRouters(src, mountedVars) {
  const result = new Map(); // varName -> { guardLine, guardSites: [], routes, nested }
  for (const v of mountedVars) result.set(v, { guardLine: null, routes: [], nested: [] });
  for (const site of callSites(src)) {
    const entry = site.varName ? result.get(site.varName) : undefined;
    if (!entry) continue; // nested factory routers / locals: handled by factoryRoutes
    if (site.method === "use") {
      if (site.args.length === 1 && site.args[0] === "requireAuth") {
        entry.guardLine = entry.guardLine ?? site.line; // first binding guard wins
        continue;
      }
      const mountPath = stringLiteral(site.args[0] ?? "");
      const factory = site.args[1] ? factoryCall(site.args[1]) : null;
      if (mountPath !== null && factory) {
        entry.nested.push({ mountPath, factory, line: site.line });
      }
      continue; // other .use(...) middleware (e.g. the admin role gate) is not a route
    }
    const path = stringLiteral(site.args[0] ?? "");
    if (!path || !path.startsWith("/")) continue;
    const middlewareText = site.args.slice(1, -1).join(", ");
    const permission = /requirePermission\(\s*"([^"]+)"/.exec(middlewareText);
    entry.routes.push({
      method: site.method.toUpperCase(),
      path,
      line: site.line,
      requireAuth: /(^|[^\w$.])requireAuth([^\w$]|$)/.test(middlewareText),
      permission: permission ? permission[1] : null,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function joinPaths(...segments) {
  const joined = segments
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `/${joined}`;
}

export function buildMatrix() {
  const appSrc = readFileSync(APP_TS, "utf8");
  const imports = parseModuleImports(appSrc);
  const mounts = parseMounts(appSrc);
  const byRole = parsePermissions();

  const violations = [];
  const usedPublicRoutes = new Set();
  const sections = [];

  for (const mount of mounts) {
    if (!imports.has(mount.routerVar)) {
      throw new Error(`app.ts mounts ${mount.routerVar} at ${mount.path} but no ./modules/ import defines it`);
    }
    const file = imports.get(mount.routerVar);
    const relFile = file.slice(API_DIR.length + 1).replace(/\\/g, "/");
    const src = readFileSync(file, "utf8");
    const routers = parseMountedRouters(src, [mount.routerVar]);
    const { byFactory } = factoryRoutes(src);
    const entry = routers.get(mount.routerVar);
    const moduleGuarded = entry.guardLine !== null;

    const rows = [];
    const classify = (route) => {
      const fullPath = joinPaths(mount.path, route.path);
      const key = `${route.method} ${fullPath}`;
      if (route.requireAuth) return { auth: "guard: route", notes: "—", key, fullPath };
      if (moduleGuarded) return { auth: "guard: module", notes: "—", key, fullPath };
      if (PUBLIC_ROUTES[key]) {
        usedPublicRoutes.add(key);
        return { auth: "public", notes: PUBLIC_ROUTES[key], key, fullPath };
      }
      violations.push(`${relFile}:${route.line}  ${key} is unguarded and not in the public allowlist`);
      return { auth: "UNCLASSIFIED", notes: "—", key, fullPath };
    };

    for (const route of entry.routes) {
      const c = classify(route);
      const roles = route.permission ? rolesForPermission(byRole, route.permission) : moduleGuarded || route.requireAuth ? ["any authenticated role"] : [];
      rows.push({
        method: route.method,
        fullPath: c.fullPath,
        auth: c.auth,
        permission: route.permission,
        roles,
        notes: c.notes,
      });
    }

    for (const nested of entry.nested) {
      const childRoutes = byFactory.get(nested.factory) ?? [];
      if (childRoutes.length === 0) {
        violations.push(`${relFile}:${nested.line}  nested router ${nested.factory}() has no registrable routes — parser or source shape changed`);
        continue;
      }
      for (const route of childRoutes) {
        const fullPath = joinPaths(mount.path, nested.mountPath, route.path);
        const key = `${route.method} ${fullPath}`;
        if (!moduleGuarded && !PUBLIC_ROUTES[key]) {
          violations.push(`${relFile}:${nested.line}  nested route ${key} is unguarded and not in the public allowlist`);
        }
        if (!moduleGuarded && PUBLIC_ROUTES[key]) usedPublicRoutes.add(key);
        rows.push({
          method: route.method,
          fullPath,
          auth: moduleGuarded ? "guard: module" : PUBLIC_ROUTES[key] ? "public" : "UNCLASSIFIED",
          permission: route.permission,
          roles: route.permission ? rolesForPermission(byRole, route.permission) : moduleGuarded ? ["any authenticated role"] : [],
          notes: `nested router \`${nested.factory}()\` mounted at \`${nested.mountPath}\``,
        });
      }
    }

    sections.push({ mount, routerVar: mount.routerVar, relFile, moduleGuarded, rows });
  }

  for (const key of Object.keys(PUBLIC_ROUTES)) {
    if (!usedPublicRoutes.has(key)) {
      violations.push(`public allowlist entry "${key}" matches no discovered route — remove it or fix the path`);
    }
  }
  if (violations.length) {
    throw new Error(
      "route-role-matrix: refusing to render until every route is classified.\n" +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  }

  const lines = [];
  lines.push("# Route × role matrix");
  lines.push("");
  lines.push("> Generated by `apps/api/scripts/generate-route-matrix.mjs` — do not edit.");
  lines.push("> Regenerate: `node apps/api/scripts/generate-route-matrix.mjs`.");
  lines.push("> Drift gate: `apps/api/tests/route-role-matrix.test.ts` compares this file with a fresh in-memory render.");
  lines.push("");
  lines.push("Auth values:");
  lines.push("");
  lines.push("- `guard: module` — a module-level `router.use(requireAuth)` covers every route registered below it.");
  lines.push("- `guard: route` — `requireAuth` is listed on that route.");
  lines.push("- `public` — deliberately unauthenticated; the reason is listed below and enforced by the generator.");
  lines.push("");
  lines.push("Roles are derived from `src/middleware/rbac.ts`: a `requirePermission` route lists every role whose permission set contains the key (`SUPER_ADMIN` holds `*`, so it appears everywhere).");
  lines.push("");

  lines.push("## Public routes (explicit allowlist)");
  lines.push("");
  lines.push("| Route | Reason |");
  lines.push("|---|---|");
  const usedKeys = [...usedPublicRoutes].sort();
  for (const key of usedKeys) lines.push(`| \`${key}\` | ${PUBLIC_ROUTES[key]} |`);
  lines.push("");

  lines.push("## Mount overview");
  lines.push("");
  lines.push("| Mount | Router | Module guard | Routes | Public |");
  lines.push("|---|---|---|---|---|");
  for (const s of sections) {
    const publicCount = s.rows.filter((r) => r.auth === "public").length;
    lines.push(
      `| \`${s.mount.path}\` | \`${s.routerVar}\` | ${s.moduleGuarded ? "yes" : "no"} | ${s.rows.length} | ${publicCount} |`,
    );
  }
  lines.push("");

  for (const s of sections) {
    lines.push(`### \`${s.mount.path}\` → \`${s.routerVar}\``);
    lines.push("");
    lines.push(
      s.moduleGuarded
        ? "Module guard: `requireAuth` on the router"
        : "Module guard: none — classification is per route.",
    );
    lines.push("");
    lines.push(`Source: \`${s.relFile}\``);
    lines.push("");
    lines.push("| Method | Path | Auth | Permission | Roles | Notes |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of s.rows) {
      const roles = r.roles.length ? r.roles.join(", ") : "—";
      lines.push(
        `| ${r.method} | \`${r.fullPath}\` | ${r.auth} | ${r.permission ? `\`${r.permission}\`` : "—"} | ${roles} | ${r.notes} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const rendered = buildMatrix();
  const check = process.argv.includes("--check");
  if (check) {
    let current = "";
    try {
      current = readFileSync(OUT_MD, "utf8");
    } catch {
      console.error(`${OUT_MD} does not exist — run without --check to generate it`);
      process.exit(1);
    }
    if (current !== rendered) {
      console.error(`${OUT_MD} is stale — regenerate with: node apps/api/scripts/generate-route-matrix.mjs`);
      process.exit(1);
    }
    console.log(`${OUT_MD} is up to date`);
    return;
  }
  writeFileSync(OUT_MD, rendered, "utf8");
  console.log(`wrote ${OUT_MD} (${rendered.split("\n").length - 1} lines)`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
