#!/usr/bin/env node
/**
 * Environment reference generator.
 *
 * Emits docs/env-reference.md from two sources, so the doc cannot invent a
 * variable: the zod schema in src/config/env.ts (what the API actually reads
 * and validates) and .env.example (what an operator is told to set). Anything
 * in one and not the other is called out explicitly — the schema table covers
 * the API's contract, the second table covers example-only names (read via
 * process.env outside the schema, or consumed by the web build).
 *
 * Drift gate: tests/generated-docs-freshness.test.ts re-renders in memory and
 * fails when the committed file differs byte-for-byte.
 *
 * Usage:
 *   node apps/api/scripts/generate-env-reference.mjs          # write the doc
 *   node apps/api/scripts/generate-env-reference.mjs --check  # exit 1 on drift
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(API_DIR, "..", "..");
const ENV_TS = resolve(API_DIR, "src/config/env.ts");
const ENV_EXAMPLE = resolve(REPO_ROOT, ".env.example");
const OUT_MD = resolve(REPO_ROOT, "docs/env-reference.md");

/** Slice a balanced `{ ... }` / `( ... )` region starting at `open`. */
function sliceBalanced(src, open) {
  const closer = src[open] === "{" ? "}" : ")";
  const opener = src[open];
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === opener) depth += 1;
    else if (ch === closer) {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
    i += 1;
  }
  throw new Error("unbalanced region in source");
}

/** Flatten a JSDoc / line-comment block into one sentence-ish line. */
function flattenComment(lines) {
  const text = lines
    .join(" ")
    .replace(/\/\*\*?/g, " ")
    .replace(/\*\//g, " ")
    .replace(/(^|\s)\*\s?/g, " ")
    .replace(/^\/\/\s?/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
  // The schema's own comments sometimes wrap mid-sentence with a stray "."
  // before the opening token (e.g. `*. 0 disables`); normalise that artifact.
  return text.replace(/\.\s+\./g, ".").replace(/\*\s*\./g, ".").replace(/ \. /g, ". ");
}

/** Entries of the zod object literal in src/config/env.ts. */
function parseSchema() {
  const src = readFileSync(ENV_TS, "utf8");
  const start = src.indexOf("z.object({");
  if (start === -1) throw new Error("could not locate z.object({ in config/env.ts");
  const block = sliceBalanced(src, src.indexOf("{", start));
  const entries = [];
  let comment = [];
  const lines = block.split("\n");
  let current = null;
  for (const line of lines) {
    const entryStart = /^\s{2}([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line);
    if (entryStart) {
      if (current) entries.push(current);
      current = { name: entryStart[1], text: entryStart[2], comment: flattenComment(comment) };
      comment = [];
      continue;
    }
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) {
      comment.push(line);
      continue;
    }
    if (line.trim() === "") {
      // A blank line ends a comment block that precedes an entry.
      comment = [];
      continue;
    }
    if (current) current.text += " " + line.trim();
  }
  if (current) entries.push(current);

  for (const e of entries) {
    const def = /\.default\(\s*([^)]*?)\s*\)/.exec(e.text);
    e.optional = /\.optional\(\)/.test(e.text);
    e.default = def ? def[1] : null;
    const enumMatch = /z\.enum\(\[([^\]]*)\]\)/.exec(e.text);
    if (enumMatch) {
      e.type = "enum(" + [...enumMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(" | ") + ")";
    } else if (/z\.coerce\.number\(\)/.test(e.text)) {
      e.type = "number";
    } else if (/z\.literal\(/.test(e.text)) {
      e.type = `literal(${/z\.literal\(([^)]*)\)/.exec(e.text)?.[1] ?? ""})`;
    } else if (/z\.union\(/.test(e.text)) {
      const inner = sliceBalanced(e.text, e.text.indexOf("z.union(") + "z.union".length);
      const parts = [];
      if (/z\.coerce\.number\(\)/.test(inner)) parts.push("number");
      const lit = /z\.literal\("([^"]+)"\)/.exec(inner);
      if (lit) parts.push(`"${lit[1]}"`);
      e.type = parts.join(" | ") || "union";
    } else {
      e.type = "string";
      if (/\.url\(\)/.test(e.text)) e.type = "string (url)";
    }
    e.required = !e.optional && e.default === null;
  }
  return entries;
}

/** Names set in .env.example with the value shown and the trailing comment. */
function parseEnvExample() {
  const src = readFileSync(ENV_EXAMPLE, "utf8");
  const out = [];
  let preceding = [];
  for (const line of src.split("\n")) {
    const m = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) {
      // Comment lines directly above a setting describe it; a blank line
      // (or non-comment content) ends the block.
      const text = line.replace(/^\s*#\s?/, "");
      // Section dividers and commented-out assignments are not descriptions.
      const isSectionDivider = /^-{2,}.*-{2,}$/.test(text.trim());
      const isCommentedAssignment = /^[A-Z][A-Z0-9_]*=/.test(text.trim());
      if (/^\s*#/.test(line) && line.trim() !== "" && !isSectionDivider && !isCommentedAssignment) preceding.push(text.trim());
      else if (line.trim() === "") preceding = [];
      continue;
    }
    const commented = Boolean(m[1]);
    const raw = m[3];
    const value = raw.split("#")[0].trim();
    const trailing = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1).trim() : "";
    // A prose line that merely mentions NAME=value (for example
    // "# SMS_PROVIDER=http posts { to, text } ...") is not a setting: real
    // values in the template never contain whitespace.
    if (/\s/.test(value)) continue;
    out.push({ name: m[2], value, trailing, commented, preceding: preceding.join(" ") });
    preceding = [];
  }
  return out;
}

export function buildEnvReference() {
  const schema = parseSchema();
  const example = parseEnvExample();
  const byName = new Map();
  for (const e of example) {
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name).push(e);
  }

  const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [];
  lines.push("# Environment reference");
  lines.push("");
  lines.push("> Generated by `apps/api/scripts/generate-env-reference.mjs` — do not edit.");
  lines.push("> Regenerate: `node apps/api/scripts/generate-env-reference.mjs`.");
  lines.push("> Drift gate: `apps/api/tests/generated-docs-freshness.test.ts` compares this file with a fresh in-memory render.");
  lines.push("");
  lines.push("The first table is the API's contract: every variable is parsed and validated by the zod schema in `apps/api/src/config/env.ts`, which refuses to start on invalid input. \"Required\" means no default exists — startup fails when the variable is absent.");
  lines.push("");
  lines.push("| Variable | Type | Default | Required | Purpose | In `.env.example` |");
  lines.push("|---|---|---|---|---|---|");
  for (const e of schema) {
    const ex = byName.get(e.name) ?? [];
    // Purpose falls back to the template's trailing comment when the schema
    // itself carries none: the operator-facing note is still the best
    // available description of what the variable does.
    const fromTemplate = ex.find((x) => x.trailing || x.preceding);
    const purposeFromTemplate = fromTemplate ? fromTemplate.trailing || fromTemplate.preceding : "—";
    const uniqueValues = [...new Set(ex.map((x) => x.value))];
    let exCell = "—";
    if (ex.length === 1) exCell = `\`${esc(ex[0].value)}\`${ex[0].commented ? " (commented)" : ""}`;
    else if (ex.length > 1)
      exCell = `repeated: ${uniqueValues.map((v) => `\`${esc(v)}\``).join(", ")}${ex.some((x) => x.commented) ? " (some commented)" : ""}`;
    lines.push(
      `| \`${e.name}\` | ${esc(e.type)} | ${e.default !== null ? `\`${esc(e.default)}\`` : e.optional ? "— (optional)" : "—"} | ${e.required ? "yes" : "no"} | ${esc(e.comment || purposeFromTemplate)} | ${exCell} |`,
    );
  }
  lines.push("");

  const exampleOnly = [...byName.keys()].filter((n) => !schema.some((e) => e.name === n));
  lines.push("## Names in `.env.example` outside the API schema");
  lines.push("");
  lines.push("These are read via `process.env` outside `config/env.ts` (for example the logger's `LOG_LEVEL`) or consumed by other workspaces (the `VITE_*` build inputs reach the web bundle, not the API). They are listed so an operator sees the whole template; check the reader before relying on a default.");
  lines.push("");
  lines.push("| Variable | Example value | Comment in template |");
  lines.push("|---|---|---|");
  for (const name of exampleOnly.sort()) {
    const first = byName.get(name)[0];
    lines.push(`| \`${name}\` | \`${esc(first.value)}\`${first.commented ? " (commented)" : ""} | ${esc(first.trailing) || "—"} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const rendered = buildEnvReference();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(OUT_MD, "utf8");
    } catch {
      console.error(`${OUT_MD} does not exist — run without --check to generate it`);
      process.exit(1);
    }
    if (current !== rendered) {
      console.error(`${OUT_MD} is stale — regenerate with: node apps/api/scripts/generate-env-reference.mjs`);
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
