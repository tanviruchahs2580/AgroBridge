import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Prisma schema parity guard (D-04).
 *
 * The codebase keeps three schema copies in sync:
 *  - prisma/schema.prisma             (sqlite, dev/test)
 *  - prisma/schema.postgresql.prisma  (the ADR-0004 parity copy, validated in CI)
 *  - prisma/postgres/schema.prisma    (production: serverless engine target + the
 *                                      migration chain `deploy-migrations.mjs` applies)
 *
 * The previous guard compared model names, field names and raw `@@index(...)`
 * strings via regex. It missed scalar types, optionality/arrays, `@unique`,
 * `@default`, `@relation` contents and `@@unique` — the drift classes that have
 * shipped to production before (a heldPaisa column missing from one copy; a
 * composite index present only in the sqlite chain). This version parses each
 * `model`/`enum` block into structures and compares them field by field.
 *
 * The only differences allowed are the genuine dialect/deploy-target
 * differences listed in DIALECT_ALLOWLIST below; everything else must match.
 */
const root = fileURLToPath(new URL("..", import.meta.url));

// ---------------------------------------------------------------------------
// Block parser (dependency-free)
// ---------------------------------------------------------------------------

export type ParsedField = {
  name: string;
  /** scalar or model name, without `?`/`[]` decorations */
  type: string;
  optional: boolean;
  array: boolean;
  /** whitespace-normalized attribute expressions, e.g. `@unique`, `@default(0)` */
  attrs: string[];
};

export type ParsedModel = {
  fields: Map<string, ParsedField>;
  /** `@@keyword` -> its canonical argument sets, e.g. unique/index */
  blockAttrs: Map<string, Set<string>>;
};

export type ParsedSchema = {
  models: Map<string, ParsedModel>;
  enums: Map<string, string[]>;
  /** datasource name -> provider */
  providers: Map<string, string>;
  /** generator name -> key -> canonical value */
  generators: Map<string, Map<string, string>>;
};

export type SchemaDiff = { kind: string; target: string; detail: string };

/** Suppresses one known-good difference; anything not listed here fails the guard. */
export type AllowlistedDifference = { kind: string; target: string; reason: string };

/** Removes a `//` comment unless it sits inside a double-quoted string. */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Drops all whitespace outside double-quoted strings so formatting never matters. */
function canonical(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (!/\s/.test(ch)) out += ch;
  }
  return out;
}

/** Net `{`/`}` count of a line, ignoring braces inside quoted strings. */
function braceDelta(line: string): number {
  let delta = 0;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") delta++;
    else if (ch === "}") delta--;
  }
  return delta;
}

/** Splits on whitespace at paren/bracket depth 0, keeping `@relation(...)` in one token. */
function splitTopTokens(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inString) {
      current += ch;
      if (ch === "\\") current += line[++i] ?? "";
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      current += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

type RawBlock = { kind: "model" | "enum" | "datasource" | "generator"; name: string; body: string[] };

/** Extracts top-level blocks by brace balance; Prisma's one-brace-per-line format is assumed. */
function extractBlocks(source: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  let head: RawBlock | null = null;
  let depth = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (head) {
      const delta = braceDelta(line);
      if (depth + delta <= 0) {
        blocks.push(head);
        head = null;
        depth = 0;
        continue;
      }
      depth += delta;
      head.body.push(line);
      continue;
    }
    const m = /^\s*(model|enum|datasource|generator)\s+(\w+)\s*\{\s*$/.exec(line);
    if (m) {
      head = { kind: m[1] as RawBlock["kind"], name: m[2]!, body: [] };
      depth = 1;
    }
  }
  return blocks;
}

function parseModel(body: string[]): ParsedModel {
  const fields = new Map<string, ParsedField>();
  const blockAttrs = new Map<string, Set<string>>();
  for (const line of body) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("@@")) {
      const m = /^@@(\w+)\s*(?:\((.*)\))?\s*$/.exec(t);
      if (!m) continue;
      const set = blockAttrs.get(m[1]!) ?? new Set<string>();
      set.add(canonical(m[2] ?? ""));
      blockAttrs.set(m[1]!, set);
      continue;
    }
    const tokens = splitTopTokens(t);
    const [name, typeToken] = tokens;
    if (!name || !typeToken) continue;
    const tm = /^([A-Za-z_]\w*)(\[\])?(\?)?$/.exec(typeToken);
    if (!tm) continue;
    fields.set(name, {
      name,
      type: tm[1]!,
      array: tm[2] !== undefined,
      optional: tm[3] !== undefined,
      attrs: tokens.slice(2).map(canonical).sort(),
    });
  }
  return { fields, blockAttrs };
}

function parseEnum(body: string[]): string[] {
  const values: string[] = [];
  for (const line of body) {
    for (const token of line.trim().split(/\s+/)) {
      if (token) values.push(token);
    }
  }
  return values;
}

/** `key = value` assignments inside a datasource/generator block. */
function parseAssignments(body: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of body) {
    const t = line.trim();
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    out.set(t.slice(0, eq).trim(), canonical(t.slice(eq + 1)));
  }
  return out;
}

/** Parses one `.prisma` source into models, enums, datasource providers and generators. */
export function parsePrismaSchema(source: string): ParsedSchema {
  const models = new Map<string, ParsedModel>();
  const enums = new Map<string, string[]>();
  const providers = new Map<string, string>();
  const generators = new Map<string, Map<string, string>>();
  for (const block of extractBlocks(source)) {
    if (block.kind === "model") models.set(block.name, parseModel(block.body));
    else if (block.kind === "enum") enums.set(block.name, parseEnum(block.body));
    else if (block.kind === "datasource") {
      const provider = parseAssignments(block.body).get("provider");
      if (provider) providers.set(block.name, provider);
    } else generators.set(block.name, parseAssignments(block.body));
  }
  return { models, enums, providers, generators };
}

// ---------------------------------------------------------------------------
// Comparator
// ---------------------------------------------------------------------------

/**
 * The commented allowlist of genuine dialect differences. Enumerated by diffing
 * the three copies on 2026-10-18 (before this guard was strengthened; the full
 * diff is recorded in .audit/evidence/E-S-01-schema-and-migrations.txt):
 *
 *  1. `db.provider`: sqlite for dev/test reproducibility, postgresql for both
 *     production copies (ADR-0004).
 *  2. `client.binaryTargets`: only the shipping copy (prisma/postgres/
 *     schema.prisma) declares `["native", "rhel-openssl-3.0.x"]` for the Vercel
 *     runtime; the dev/test copies imply `native` and nothing else.
 *
 * Neither may hide a semantic mismatch: provider and generator deployment
 * targets are the only things that legitimately differ between profiles.
 * Formatting drift (blank lines, the order of `@@index` lines in Withdrawal) is
 * normalized away by the parser, not allowlisted.
 */
export const DIALECT_ALLOWLIST: AllowlistedDifference[] = [
  {
    kind: "datasource-provider",
    target: "db.provider",
    reason: "sqlite (dev/test) vs postgresql (production copies) — ADR-0004",
  },
  {
    kind: "generator-config",
    target: "client.binaryTargets",
    reason: "serverless engine target declared only in the shipping copy — ADR-0004",
  },
];

function hasAttr(field: ParsedField, attr: string): boolean {
  return field.attrs.some((a) => a === attr || a.startsWith(`${attr}(`));
}

/** Relations of one model: `field->Target[?][]`, resolved against the model set. */
function relationList(model: ParsedModel, modelNames: Set<string>): string[] {
  return [...model.fields.values()]
    .filter((f) => modelNames.has(f.type))
    .map((f) => `${f.name}->${f.type}${f.array ? "[]" : ""}${f.optional ? "?" : ""}`)
    .sort();
}

/**
 * Compares two parsed schemas and returns every difference not covered by the
 * allowlist. Exported so the self-checks below (and any future dialect guard)
 * can feed it tiny in-memory schemas.
 */
export function compareSchemas(
  a: ParsedSchema,
  b: ParsedSchema,
  label: string,
  allowlist: AllowlistedDifference[] = [],
): SchemaDiff[] {
  const diffs: SchemaDiff[] = [];
  const push = (kind: string, target: string, detail: string) => diffs.push({ kind, target, detail });

  // Datasource providers.
  for (const [name, pa] of a.providers) {
    const pb = b.providers.get(name);
    if (pb === undefined) push("datasource", name, `${label}: datasource present only in the first schema`);
    else if (pa !== pb) push("datasource-provider", `${name}.provider`, `${label}: ${pa} vs ${pb}`);
  }
  for (const name of b.providers.keys()) {
    if (!a.providers.has(name)) push("datasource", name, `${label}: datasource present only in the second schema`);
  }

  // Generators (provider must match; binaryTargets is the one allowlisted key).
  const generatorNames = new Set([...a.generators.keys(), ...b.generators.keys()]);
  for (const name of generatorNames) {
    const ga = a.generators.get(name);
    const gb = b.generators.get(name);
    if (!ga || !gb) {
      push("generator", name, `${label}: generator present only in one schema`);
      continue;
    }
    for (const key of new Set([...ga.keys(), ...gb.keys()])) {
      const va = ga.get(key);
      const vb = gb.get(key);
      if (va !== vb) push("generator-config", `${name}.${key}`, `${label}: ${va ?? "(missing)"} vs ${vb ?? "(missing)"}`);
    }
  }

  // Models: same set, then field-by-field.
  const modelNames = new Set([...a.models.keys(), ...b.models.keys()]);
  for (const name of [...modelNames].sort()) {
    const ma = a.models.get(name);
    const mb = b.models.get(name);
    if (!ma || !mb) {
      push("models", name, `${label}: model present only in one schema`);
      continue;
    }

    for (const fieldName of new Set([...ma.fields.keys(), ...mb.fields.keys()])) {
      const fa = ma.fields.get(fieldName);
      const fb = mb.fields.get(fieldName);
      const target = `${name}.${fieldName}`;
      if (!fa || !fb) {
        push("field", target, `${label}: field present only in one schema`);
        continue;
      }
      const aspect = (what: string, va: string, vb: string) => {
        if (va !== vb) push("field", target, `${label}: ${what} ${va} vs ${vb}`);
      };
      aspect("scalar type", fa.type, fb.type);
      aspect("optional", String(fa.optional), String(fb.optional));
      aspect("array", String(fa.array), String(fb.array));
      aspect("@unique presence", String(hasAttr(fa, "@unique")), String(hasAttr(fb, "@unique")));
      aspect("@default presence", String(hasAttr(fa, "@default")), String(hasAttr(fb, "@default")));
      // Full attribute multiset: catches @relation contents (onDelete etc.),
      // @updatedAt, @id and any future attribute drift.
      aspect("attributes", `[${fa.attrs.join(" ")}]`, `[${fb.attrs.join(" ")}]`);
    }

    // Relation targets.
    const ra = relationList(ma, modelNames);
    const rb = relationList(mb, modelNames);
    if (ra.join(",") !== rb.join(",")) {
      push("relation", name, `${label}: relations [${ra.join(" ")}] vs [${rb.join(" ")}]`);
    }

    // `@@unique` / `@@index` / any other block attribute, as sets.
    for (const keyword of new Set([...ma.blockAttrs.keys(), ...mb.blockAttrs.keys()])) {
      const sa = ma.blockAttrs.get(keyword) ?? new Set<string>();
      const sb = mb.blockAttrs.get(keyword) ?? new Set<string>();
      const onlyA = [...sa].filter((x) => !sb.has(x)).sort();
      const onlyB = [...sb].filter((x) => !sa.has(x)).sort();
      if (onlyA.length || onlyB.length) {
        const kind = keyword === "unique" ? "unique" : keyword === "index" ? "index" : "block-attribute";
        push(kind, `${name}.@@${keyword}`, `${label}: first-only [${onlyA.join(" ")}] second-only [${onlyB.join(" ")}]`);
      }
    }
  }

  // Enums: same set and same values.
  for (const name of new Set([...a.enums.keys(), ...b.enums.keys()])) {
    const ea = a.enums.get(name);
    const eb = b.enums.get(name);
    if (!ea || !eb) {
      push("enums", name, `${label}: enum present only in one schema`);
      continue;
    }
    if (ea.join(" ") !== eb.join(" ")) {
      push("enums", name, `${label}: values [${ea.join(" ")}] vs [${eb.join(" ")}]`);
    }
  }

  return diffs.filter((d) => !allowlist.some((allowed) => allowed.kind === d.kind && allowed.target === d.target));
}

// ---------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------

const sqlite = parsePrismaSchema(readFileSync(root + "prisma/schema.prisma", "utf8"));
const pgCopy = parsePrismaSchema(readFileSync(root + "prisma/schema.postgresql.prisma", "utf8"));
/**
 * The copy production actually runs (`prisma/postgres/` — the one with the
 * serverless engine target, whose migration chain `deploy-migrations.mjs`
 * applies and the CI PostgreSQL job provisions from). It was outside the old
 * guard until 2026-10-18.
 */
const shipping = parsePrismaSchema(readFileSync(root + "prisma/postgres/schema.prisma", "utf8"));

const COPIES: Array<[string, ParsedSchema]> = [
  ["prisma/schema.postgresql.prisma", pgCopy],
  ["prisma/postgres/schema.prisma", shipping],
];

function diffsAgainstSqlite(kind: (d: SchemaDiff) => boolean): SchemaDiff[] {
  const out: SchemaDiff[] = [];
  for (const [label, copy] of COPIES) {
    out.push(...compareSchemas(sqlite, copy, label, DIALECT_ALLOWLIST).filter(kind));
  }
  return out;
}

describe("Prisma schema parity — sqlite vs postgresql", () => {
  it("same model set", () => {
    expect([...pgCopy.models.keys()].sort()).toEqual([...sqlite.models.keys()].sort());
    expect([...shipping.models.keys()].sort()).toEqual([...sqlite.models.keys()].sort());
  });

  it("same enum set", () => {
    expect([...pgCopy.enums.keys()].sort()).toEqual([...sqlite.enums.keys()].sort());
    expect([...shipping.enums.keys()].sort()).toEqual([...sqlite.enums.keys()].sort());
  });

  it("same fields per model — name, scalar type, optionality, array and attributes", () => {
    expect(diffsAgainstSqlite((d) => d.kind === "field" || d.kind === "models")).toEqual([]);
  });

  it("same relation targets per model", () => {
    expect(diffsAgainstSqlite((d) => d.kind === "relation")).toEqual([]);
  });

  it("same @@unique / @@index sets per model", () => {
    expect(diffsAgainstSqlite((d) => d.kind === "unique" || d.kind === "index" || d.kind === "block-attribute")).toEqual([]);
  });

  it("no unallowlisted difference anywhere in the schemas", () => {
    expect(diffsAgainstSqlite(() => true)).toEqual([]);
  });

  it("raw diffs (allowlist disabled) are exactly the allowlisted dialect differences", () => {
    for (const [label, copy] of COPIES) {
      const raw = compareSchemas(sqlite, copy, label);
      const unexpected = raw.filter(
        (d) => !DIALECT_ALLOWLIST.some((allowed) => allowed.kind === d.kind && allowed.target === d.target),
      );
      expect(unexpected).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Comparator self-checks — prove the guard is not vacuous
// ---------------------------------------------------------------------------

const TINY_SCHEMA = `datasource db {
  provider = "sqlite"
  url = env("DATABASE_URL")
}

model Order {
  id String @id @default(cuid())
  qty Int
}
`;

describe("comparator self-checks", () => {
  it("reports a scalar-type mismatch", () => {
    const drifted = TINY_SCHEMA.replace("qty Int", "qty String");
    const diffs = compareSchemas(parsePrismaSchema(TINY_SCHEMA), parsePrismaSchema(drifted), "self-check");
    const field = diffs.find((d) => d.kind === "field" && d.target === "Order.qty");
    expect(field).toBeDefined();
    expect(field!.detail).toContain("Int");
    expect(field!.detail).toContain("String");
  });

  it("reports and then allowlists a datasource-provider difference, and nothing else", () => {
    const pg = TINY_SCHEMA.replace('provider = "sqlite"', 'provider = "postgresql"');
    const raw = compareSchemas(parsePrismaSchema(TINY_SCHEMA), parsePrismaSchema(pg), "self-check");
    expect(raw.map((d) => `${d.kind}:${d.target}`)).toEqual(["datasource-provider:db.provider"]);
    expect(
      compareSchemas(parsePrismaSchema(TINY_SCHEMA), parsePrismaSchema(pg), "self-check", DIALECT_ALLOWLIST),
    ).toEqual([]);
  });

  it("reports a missing @@unique and a changed @default value", () => {
    const drifted = TINY_SCHEMA.replace("qty Int", "qty Int @default(1)").replace(
      "  id String @id @default(cuid())\n",
      "  id String @id\n  sku String\n  @@unique([sku])\n",
    );
    const diffs = compareSchemas(parsePrismaSchema(TINY_SCHEMA), parsePrismaSchema(drifted), "self-check");
    expect(diffs.some((d) => d.kind === "field" && d.target === "Order.qty" && d.detail.includes("@default"))).toBe(true);
    expect(diffs.some((d) => d.kind === "unique" && d.target === "Order.@@unique")).toBe(true);
  });
});
