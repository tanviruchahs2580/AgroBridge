import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The codebase keeps three schema copies in sync:
 *  - prisma/schema.prisma             (sqlite, dev/test)
 *  - prisma/schema.postgresql.prisma  (the ADR-0004 parity copy)
 *  - prisma/postgres/schema.prisma    (production: serverless engine target + the
 *                                      migration chain `deploy-migrations.mjs` applies)
 * Drift between them would silently break production deploys (e.g. heldPaisa
 * missing from PG, or an index that only exists in the sqlite chain), so compare
 * them field by field at build/test time — including the copy that actually ships.
 */
const root = fileURLToPath(new URL("..", import.meta.url));

function parseModels(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const re = /model\s+(\w+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const fields = new Set<string>();
    for (const line of m[2].split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
      const name = t.split(/\s+/)[0];
      if (name) fields.add(name);
    }
    out.set(m[1]!, fields);
  }
  return out;
}

/** Extract each model's declared @@index attributes (index drift has shipped
 *  to production before — the sqlite schema carried [status, createdAt]
 *  composites the postgres schemas lacked, so compare them explicitly). */
function parseIndexes(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const re = /model\s+(\w+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const idx = new Set<string>();
    for (const line of m[2].split("\n")) {
      const t = line.trim();
      if (t.startsWith("@@index(")) {
        idx.add(t.slice("@@index(".length).replace(/\)$/, "").trim());
      }
    }
    out.set(m[1]!, idx);
  }
  return out;
}

describe("Prisma schema parity — sqlite vs postgresql", () => {
  const a = parseModels(readFileSync(root + "prisma/schema.prisma", "utf8"));
  const b = parseModels(readFileSync(root + "prisma/schema.postgresql.prisma", "utf8"));
  const ia = parseIndexes(readFileSync(root + "prisma/schema.prisma", "utf8"));
  const ib = parseIndexes(readFileSync(root + "prisma/schema.postgresql.prisma", "utf8"));
  /**
   * The copy production actually runs (`prisma/postgres/` — the one with the
   * serverless engine target, whose migration chain `deploy-migrations.mjs`
   * applies and the CI PostgreSQL job now provisions from). It was outside this
   * guard until 2026-10-18: the test compared two copies while the shipping one
   * was free to drift, which is the opposite of what a drift guard is for.
   */
  const c = parseModels(readFileSync(root + "prisma/postgres/schema.prisma", "utf8"));
  const ic = parseIndexes(readFileSync(root + "prisma/postgres/schema.prisma", "utf8"));

  it("same model set", () => {
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    expect([...c.keys()].sort()).toEqual([...a.keys()].sort());
  });

  it("same fields per model", () => {
    const diffs: string[] = [];
    for (const [model, fields] of a) {
      for (const [label, other] of [
        ["pg-copy", b.get(model)],
        ["production-copy", c.get(model)],
      ] as const) {
        if (!other) continue; // reported by the model-set test
        const onlyA = [...fields].filter((f) => !other.has(f));
        const onlyB = [...other].filter((f) => !fields.has(f));
        if (onlyA.length || onlyB.length) diffs.push(`${model} (${label}): sqlite-only[${onlyA}] copy-only[${onlyB}]`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it("same declared indexes per model", () => {
    const diffs: string[] = [];
    for (const [model, idx] of ia) {
      if (idx.size === 0) continue; // models without explicit indexes
      for (const [label, other] of [
        ["pg-copy", ib.get(model) ?? new Set<string>()],
        ["production-copy", ic.get(model) ?? new Set<string>()],
      ] as const) {
        const onlyA = [...idx].filter((x) => !other.has(x));
        const onlyB = [...other].filter((x) => !idx.has(x));
        if (onlyA.length || onlyB.length) diffs.push(`${model} (${label}): sqlite-only[${onlyA}] copy-only[${onlyB}]`);
      }
    }
    expect(diffs).toEqual([]);
  });
});
