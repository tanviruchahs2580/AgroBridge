#!/usr/bin/env node
/**
 * ERD generator (DOC-07 / ADR-0014): parses the Prisma schema's model blocks and
 * emits a Mermaid `erDiagram` at docs/generated/erd.mmd. Attribute-level detail
 * (defaults, FK targets) is intentionally out of scope — the ERD is the shape
 * overview; docs/database.md and `prisma/migrations` stay authoritative.
 * `--check` fails when the committed output no longer matches the schema.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(apiRoot, "prisma", "schema.prisma");
const OUT_MD = path.join(apiRoot, "..", "..", "docs", "generated", "erd.mmd");
const CHECK = process.argv.includes("--check");

const schema = readFileSync(schemaPath, "utf8");
const PRIMITIVES = new Set(["string", "int", "float", "boolean", "datetime", "decimal", "bigint", "bytes", "json"]);

const entities = [];
for (const block of schema.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
  const model = block[1];
  const fields = [];
  for (const line of block[2].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@") || trimmed.startsWith("@")) continue;
    const field = /^(\w+)\s+([\w\[\]?]+)/.exec(trimmed);
    if (!field) continue;
    const [, name, rawType] = field;
    const base = rawType.replace(/[\[\]?]/g, "").trim();
    const kind = PRIMITIVES.has(base.toLowerCase()) ? base.toLowerCase() : "relation";
    fields.push(`  ${kind} ${name}`);
  }
  entities.push(`  ${model} {\n${fields.join("\n")}\n  }`);
}

const md = `// ERD (generated — do not edit by hand; regenerate: node apps/api/scripts/gen-erd.mjs)\n` +
  `erDiagram\n${entities.join("\n")}\n`;

if (CHECK) {
  const committed = readFileSync(OUT_MD, "utf8");
  if (committed !== md) {
    console.error("ERD drift — regenerate: node apps/api/scripts/gen-erd.mjs");
    process.exit(1);
  }
  console.log(`ERD up to date (${entities.length} models)`);
} else {
  writeFileSync(OUT_MD, md);
  console.log(`ERD written: ${OUT_MD} (${entities.length} models)`);
}