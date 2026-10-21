import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Route × role drift gate.
 *
 * docs/route-role-matrix.md is generated from the source, so two failure modes
 * matter: the file going stale (a route added/removed/re-guarded without
 * regenerating) and a route being mounted with NO guard and no documented
 * reason. The second is the security-relevant one: the matrix's generator
 * refuses to render an unclassified route, and this test independently checks
 * the rendered classification against the generator's own public allowlist —
 * so "marked public" can only ever mean "listed with a reason".
 *
 * The parse is of the source registration (app.ts mounts + matrix headings),
 * not of an exported list: a route added to app.ts fails this test even if
 * nobody remembers the matrix exists.
 */

const apiRoot = fileURLToPath(new URL("..", import.meta.url)); // apps/api/
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url)); // repo root
const APP_TS = `${apiRoot}src/app.ts`.replace(/\\/g, "/");
const MATRIX = `${repoRoot}docs/route-role-matrix.md`.replace(/\\/g, "/");

/**
 * The generator is a plain ESM script (it must run with bare `node`, no tsx).
 * The specifier is held in a `string` variable on purpose: a literal here
 * would make TypeScript try to typecheck the .mjs against this tsconfig, and a
 * missing declaration is a compile error, not a runtime one.
 */
type RouteMatrixModule = {
  buildMatrix: () => string;
  PUBLIC_ROUTES: Record<string, string>;
};
async function loadGenerator(): Promise<RouteMatrixModule> {
  const specifier: string = new URL("../scripts/generate-route-matrix.mjs", import.meta.url).href;
  return (await import(specifier)) as RouteMatrixModule;
}

/** All `v1.use("<path>", <routerVar>)` registrations in app.ts, in source order. */
function mountedV1Routers(): { path: string; routerVar: string }[] {
  const src = readFileSync(APP_TS, "utf8");
  return [...src.matchAll(/v1\.use\(\s*"(\/[^"]+)"\s*,\s*([A-Za-z0-9_]+)\s*\)/g)].map((m) => ({
    path: m[1],
    routerVar: m[2],
  }));
}

/** Section headings of the matrix: `### \`/auth\` → \`authRouter\``. */
function sectionsOf(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^### `([^`]+)` → `([^`]+)`$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const bodyStart = m.index + m[0].length;
    const next = md.indexOf("\n### ", bodyStart);
    out.set(`${m[1]}\u0000${m[2]}`, md.slice(bodyStart, next === -1 ? undefined : next));
  }
  return out;
}

/** Table rows of one section: method, path, auth cell. */
function routeRows(sectionBody: string): { method: string; path: string; auth: string }[] {
  return [...sectionBody.matchAll(/^\| (GET|POST|PATCH|PUT|DELETE|ALL) \| `([^`]+)` \| ([^|]+?) \|/gm)].map((m) => ({
    method: m[1],
    path: m[2],
    auth: m[3].trim(),
  }));
}

describe("route × role matrix (docs/route-role-matrix.md)", () => {
  it("the committed matrix is byte-identical to a fresh render", async () => {
    const { buildMatrix } = await loadGenerator();
    const fresh = buildMatrix();
    const committed = readFileSync(MATRIX, "utf8");
    expect(
      committed,
      "docs/route-role-matrix.md is stale — regenerate with: node apps/api/scripts/generate-route-matrix.mjs",
    ).toBe(fresh);
  });

  it("every mounted router in app.ts has a section", async () => {
    const md = readFileSync(MATRIX, "utf8");
    const sections = sectionsOf(md);
    const missing = mountedV1Routers().filter(({ path, routerVar }) => !sections.has(`${path}\u0000${routerVar}`));
    expect(
      missing,
      `Router(s) mounted in apps/api/src/app.ts but absent from the matrix:\n` +
        missing.map((m) => `  - v1.use("${m.path}", ${m.routerVar})`).join("\n") +
        `\nFix: node apps/api/scripts/generate-route-matrix.mjs`,
    ).toEqual([]);
  });

  it("every route is module-guarded, route-guarded, or explicitly allowlisted public", async () => {
    const md = readFileSync(MATRIX, "utf8");
    const { PUBLIC_ROUTES } = await loadGenerator();
    const offenders = [];
    let publicRows = 0;
    for (const [, body] of sectionsOf(md)) {
      for (const row of routeRows(body)) {
        if (row.auth === "public") {
          publicRows += 1;
          if (!PUBLIC_ROUTES[`${row.method} ${row.path}`]) {
            offenders.push(`${row.method} ${row.path} is marked public but is not in the generator's allowlist`);
          }
        } else if (row.auth !== "guard: module" && row.auth !== "guard: route") {
          offenders.push(`${row.method} ${row.path} has no recognised auth classification ("${row.auth}")`);
        }
      }
    }
    expect(offenders, `Unguarded or unclassified route(s):\n${offenders.map((o) => `  - ${o}`).join("\n")}`).toEqual([]);
    // The allowlist exists to be small: every entry must correspond to a row
    // the generator actually emitted (a stale entry would never be checked).
    for (const key of Object.keys(PUBLIC_ROUTES)) {
      expect(
        routeRows([...sectionsOf(md).values()].join("")).some((r) => `${r.method} ${r.path}` === key),
        `public allowlist entry "${key}" does not appear in the matrix`,
      ).toBe(true);
    }
    expect(publicRows).toBeGreaterThan(0);
  });

  it("the scan itself is not vacuous", () => {
    const md = readFileSync(MATRIX, "utf8");
    const sections = sectionsOf(md);
    const rows = [...sections.values()].flatMap((b) => routeRows(b));
    expect(mountedV1Routers().length).toBeGreaterThanOrEqual(18);
    expect(sections.size).toBeGreaterThanOrEqual(18);
    expect(rows.length).toBeGreaterThanOrEqual(60);
  });
});
