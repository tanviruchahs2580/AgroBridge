#!/usr/bin/env node
/**
 * OpenAPI generator (WP-19, ADR-0026 — supersedes ADR-0021's deferral).
 *
 * Derives the document from the SAME source parse as scripts/route-matrix.mjs
 * (shared `collectRoutes()`), never from a hand-written spec. Each route
 * becomes an operation with: the full mounted path (resolved from app.ts's
 * `v1.use("<prefix>", <router>)` plus per-module sub-router mounts, the same
 * fixed-point the auth scoping uses), its auth chain (bearerAuth /
 * x-permission), its `validate()` Zod schema names as `x-request-schema`, and
 * the universal ok/fail envelope (ADR-0022) as the shared response component.
 * Per-request-body JSON Schemas are the follow-up step: the envelope contract
 * and the route inventory are the parts that can be GENERATED truthfully
 * today; `x-request-schema` names the source schema so nothing is invented.
 *
 * `--check` exits 1 when the committed docs/generated/openapi.json no longer
 * matches the source (drift guard, like route-matrix --check).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { collectRoutes } from "./route-matrix.mjs";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "..", "..");
const OUT_JSON = path.join(repoRoot, "docs", "generated", "openapi.json");
const CHECK = process.argv.includes("--check");

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

/**
 * Mount resolution, statically: app.ts's `v1.use("<prefix>", <symbol>)` maps a
 * router symbol to its prefix under `/api/v1`, and each module file's
 * `<parent>.use("<path>", <childFactory>())` mounts a sub-router factory one
 * segment deeper (same fixed-point rule the auth scoping applies, because the
 * two MUST agree — the matrix's auth scope is scoped to the mounted path).
 */
function resolveMounts() {
  const appText = readFileSync(path.join(apiRoot, "src", "app.ts"), "utf8");
  const v1Mount = /app\.use\(\s*["'`](\/[^"'`]*)["'`]\s*,\s*v1\s*\)/.exec(appText);
  const apiRootPrefix = v1Mount ? v1Mount[1] : "/api/v1";

  const symbolPrefix = new Map();
  for (const m of appText.matchAll(/v1\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*(\w+)\s*\)/g)) {
    symbolPrefix.set(m[2], m[1]);
  }

  const factoryPrefix = new Map();
  const mountRe = /(\w+)\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*(\w*[Rr]outer)\(\s*\)\s*\)/g;
  for (const [, file] of ROUTE_FILES) {
    const text = readFileSync(path.join(apiRoot, "src", "modules", file), "utf8");
    for (const m of text.matchAll(mountRe)) {
      const [, parentSymbol, mountPath, factoryName] = m;
      // The parent may itself be a factory resolved earlier (fixed point).
      const parentPrefix = symbolPrefix.get(parentSymbol) ?? factoryPrefix.get(parentSymbol);
      if (parentPrefix !== undefined) factoryPrefix.set(factoryName, `${parentPrefix}${mountPath}`);
      else factoryPrefix.set(factoryName, `${mountPath}`); // unresolved parent: relative mount for pass 2
    }
  }
  // Second pass settles chains whose parent resolved in the first.
  for (const [, file] of ROUTE_FILES) {
    const text = readFileSync(path.join(apiRoot, "src", "modules", file), "utf8");
    for (const m of text.matchAll(mountRe)) {
      const [, parentSymbol, mountPath, factoryName] = m;
      if (factoryPrefix.has(factoryName) && !factoryPrefix.get(factoryName).startsWith("/api/v1")) {
        const parentPrefix = symbolPrefix.get(parentSymbol) ?? factoryPrefix.get(parentSymbol);
        if (parentPrefix !== undefined) factoryPrefix.set(factoryName, `${parentPrefix}${mountPath}`);
      }
    }
  }
  return { apiRootPrefix, symbolPrefix, factoryPrefix };
}

const httpMethods = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

function fullPathFor(route, mounts) {
  const topPrefix = mounts.symbolPrefix.get(route.router);
  if (topPrefix !== undefined) return `${mounts.apiRootPrefix}${topPrefix}${route.path}`;
  const factoryMount = mounts.factoryPrefix.get(route.router);
  if (factoryMount !== undefined) {
    return factoryMount.startsWith(mounts.apiRootPrefix)
      ? `${factoryMount}${route.path}`
      : `${mounts.apiRootPrefix}${factoryMount}${route.path}`;
  }
  // Unresolved (exported router mounted elsewhere, or an inline factory) — the
  // route matrix's PUBLIC-set guard covers the known surface; anything here is
  // a parser gap and must be visible, not silently wrong.
  return `${mounts.apiRootPrefix}/UNRESOLVED/${route.module}${route.path}`;
}

function operationIdFor(method, module, fullPath) {
  return `${method.toLowerCase()}_${module}_${fullPath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase()}`;
}

function buildOpenApi() {
  const routes = collectRoutes();
  const mounts = resolveMounts();
  const version = JSON.parse(readFileSync(path.join(repoRoot, "version.json"), "utf8")).version;

  const paths = {};
  for (const r of routes) {
    const full = fullPathFor(r, mounts);
    const openApiPath = full.replace(/:(\w+)/g, "{$1}");
    paths[openApiPath] ??= {};
    const params = [...full.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const op = {
      operationId: operationIdFor(r.method, r.module, full),
      tags: [r.module],
      description: `${r.auth}. Source: ${r.file} (${r.router}).`,
      responses: {
        default: {
          description:
            "Every response uses the shared ok/fail envelope (ADR-0022): `{ok:true, data, requestId}` " +
            "on success — `data` is specific to this operation — and " +
            "`{ok:false, error:{code, message, details?, reference}, requestId}` on failure.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ResponseEnvelope" },
            },
          },
        },
      },
    };
    if (params.length) op.parameters = params;
    if (r.schemas) op["x-request-schema"] = r.schemas;
    const permission = r.auth.match(/requirePermission:([\w:.~-]+)/);
    if (permission) op["x-permission"] = permission[1];
    op.security = r.auth === "PUBLIC" ? [] : [{ bearerAuth: [] }];
    if (r.method === "GET") op["x-idempotent"] = true;
    paths[openApiPath][r.method.toLowerCase()] = op;
  }

  // Deterministic key order (source-sorted routes → insertion order is stable,
  // but a sorted paths object survives JSON key reordering in diffs).
  const sortedPaths = {};
  for (const key of Object.keys(paths).sort()) sortedPaths[key] = paths[key];

  return {
    openapi: "3.1.0",
    info: {
      title: "AgroBridge API",
      version,
      description:
        "Agricultural marketplace and advisory API. Generated from the mounted route surface — " +
        "regenerate with `node apps/api/scripts/generate-openapi.mjs`; drift fails the freshness " +
        "test and the quality-gates job. Auth values mirror docs/generated/route-matrix.md.",
    },
    servers: [{ url: "/" }],
    tags: [...new Set(routes.map((r) => r.module))].sort().map((t) => ({ name: t })),
    paths: sortedPaths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        ResponseEnvelope: {
          oneOf: [
            {
              type: "object",
              properties: {
                ok: { const: true },
                data: {},
                requestId: { type: "string" },
              },
              required: ["ok", "data", "requestId"],
            },
            {
              type: "object",
              properties: {
                ok: { const: false },
                error: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    message: { type: "string" },
                    details: {},
                    reference: { type: "string" },
                  },
                  required: ["code", "message"],
                },
                requestId: { type: "string" },
              },
              required: ["ok", "error", "requestId"],
            },
          ],
        },
      },
    },
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const doc = buildOpenApi();
  const serialized = JSON.stringify(doc, null, 2) + "\n";
  if (CHECK) {
    const committed = readFileSync(OUT_JSON, "utf8");
    if (committed !== serialized) {
      console.error("openapi drift — regenerate: node apps/api/scripts/generate-openapi.mjs");
      process.exit(1);
    }
    const ops = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).filter((k) => httpMethods.has(k.toUpperCase())).length, 0);
    console.log(`openapi up to date (${ops} operations)`);
  } else {
    writeFileSync(OUT_JSON, serialized);
    console.log(`openapi written: ${OUT_JSON}`);
  }
}

export { buildOpenApi };
