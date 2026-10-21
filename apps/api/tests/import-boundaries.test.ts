import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Import-boundary gate (apps/api/src).
 *
 * Three properties the module layout claims and nothing enforced:
 *
 *  a. No import cycles — a cycle makes load order observable, so behaviour can
 *     differ between `tsx` (lazy) and a bundled build.
 *  b. Cross-module imports go through the other module's `routes.ts` entry
 *     point only. Reaching into `modules/<b>/<file>` couples two modules'
 *     internals; the one current exception (auth/dataExport → aiagent/routes
 *     for `liveGroundedRefs`) targets the module's public entry and is allowed
 *     by the rule itself.
 *  c. `providers/**` never imports `modules/**`: adapters are leaf
 *     dependencies of the application layer, not the other way round.
 *
 * The graph is built from tracked sources (`git ls-files`), so untracked
 * scratch files cannot weaken it. Dynamically-awaited imports count as edges;
 * package specifiers and TS `import("pkg")` type queries do not.
 */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Tracked .ts sources under apps/api/src, as repo-relative POSIX paths. */
function trackedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "apps/api/src"], { cwd: repoRoot, encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .filter((f) => f.endsWith(".ts"))
    .sort();
}

type Edge = { from: string; to: string; specifier: string };

/** Resolution mirrors Node ESM-with-TS: `./x.js` → `x.ts`, directory → `index.ts`. */
function resolveSpecifier(fromPath: string, specifier: string): string | null {
  const base = resolve(repoRoot, dirname(fromPath), specifier);
  const candidates = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, resolve(base, "index.ts")];
  for (const candidate of candidates) {
    if (candidate.endsWith(".ts") && existsSync(candidate)) {
      return relative(repoRoot, candidate).replace(/\\/g, "/");
    }
  }
  return null;
}

function importEdges(fromPath: string, source: string): Edge[] {
  const edges: Edge[] = [];
  const patterns = [
    // import ... from "x" | export ... from "x" | import "x"
    /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    // await import("x") — a dynamic edge is still a load-order dependency
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const specifier = m[1];
      if (!specifier.startsWith(".")) continue;
      const to = resolveSpecifier(fromPath, specifier);
      if (to) edges.push({ from: fromPath, to, specifier });
    }
  }
  return edges;
}

const sources = trackedSources();
const edges = sources.flatMap((f) => importEdges(f, readFileSync(resolve(repoRoot, f), "utf8")));

describe("import boundaries (apps/api/src)", () => {
  it("the scan itself is not vacuous", () => {
    expect(sources.length).toBeGreaterThanOrEqual(60);
    expect(edges.length).toBeGreaterThanOrEqual(150);
  });

  it("the import graph has no cycles", () => {
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const list = adjacency.get(e.from);
      if (list) list.push(e.to);
      else adjacency.set(e.from, [e.to]);
    }
    const state = new Map<string, "visiting" | "done">();
    const stack: string[] = [];
    const cycles: string[][] = [];
    const visit = (node: string): void => {
      const current = state.get(node);
      if (current === "done") return;
      if (current === "visiting") {
        const start = stack.indexOf(node);
        cycles.push([...stack.slice(start), node]);
        return;
      }
      state.set(node, "visiting");
      stack.push(node);
      for (const next of adjacency.get(node) ?? []) visit(next);
      stack.pop();
      state.set(node, "done");
    };
    for (const node of adjacency.keys()) visit(node);
    expect(
      cycles,
      `Import cycle(s) found — break them by moving shared code to src/shared:\n` +
        cycles.map((c) => `  ${c.join(" -> ")}`).join("\n"),
    ).toEqual([]);
  });

  it("modules/<a> only reaches modules/<b> through that module's routes.ts entry", () => {
    const offender = (e: Edge): boolean => {
      const from = /^apps\/api\/src\/modules\/([^/]+)\//.exec(e.from);
      const to = /^apps\/api\/src\/modules\/([^/]+)\/(.+)$/.exec(e.to);
      if (!from || !to) return false;
      if (from[1] === to[1]) return false; // same module
      return to[2] !== "routes.ts";
    };
    const violations = edges.filter(offender).map((e) => `${e.from} → ${e.to} (imports "${e.specifier}")`);
    expect(
      violations,
      "Deep cross-module import(s) found. Import the other module's routes.ts,\n" +
        "or move the shared helper to src/shared/**:\n" +
        violations.map((v) => `  - ${v}`).join("\n"),
    ).toEqual([]);
  });

  it("providers/** never imports from modules/**", () => {
    const violations = edges
      .filter((e) => e.from.startsWith("apps/api/src/providers/") && e.to.startsWith("apps/api/src/modules/"))
      .map((e) => `${e.from} → ${e.to} (imports "${e.specifier}")`);
    expect(
      violations,
      "Provider(s) importing application modules — invert the dependency (inject a\n" +
        "callback/type) or move the shared piece to src/shared/**:\n" +
        violations.map((v) => `  - ${v}`).join("\n"),
    ).toEqual([]);
  });
});
