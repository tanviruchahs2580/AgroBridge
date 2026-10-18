// i18n lint: ensures every t("key") used in src/ exists in lib/i18n.ts, and that no
// dictionary key is unused. Run: `npm run i18n:check`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";

function walk(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files = files.concat(walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) files.push(p);
  }
  return files;
}

// ── Inline-language-ternary ratchet (AUD-118 / G-03) ──
// Counts source sites that carry string-literal UI copy through an inline
// `lang === "bn" ? "…" : "…"` branch (also `lang == "bn"` and `isBn ?`) instead
// of the dictionary. The count is comment-aware and skips the dictionary itself,
// so commented-out code or `lib/i18n.ts` data cannot inflate it.
//
// The baseline is grandfathered debt: NEW code must use lib/i18n.ts. Lower the
// constant as files migrate to the dictionary; do not raise it.
const INLINE_LANG_BASELINE = 87; // exact count measured at 2a33ba71 remediation (E-UI-05)

/** Strip // and /* *\/ comments without touching string/template-literal bodies. */
function stripComments(txt) {
  let out = "";
  let quote = null;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    const next = txt[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < txt.length && txt[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < txt.length && !(txt[i] === "*" && txt[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * True when the ternary branch that follows a `lang === "bn" ?` site contains a
 * string literal before that ternary's `:` (nested ternaries, parens, object
 * literals and optional chaining are accounted for).
 */
function branchHasStringLiteral(txt, from) {
  let parens = 0;
  let ternaries = 0;
  for (let i = from; i < txt.length; i++) {
    const ch = txt[i];
    if (ch === '"' || ch === "'" || ch === "`") return true;
    if (ch === "(" || ch === "[" || ch === "{") parens++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (parens === 0) return false;
      parens--;
    } else if (ch === "?") {
      if (txt[i + 1] === "." || txt[i + 1] === "?") i++; // optional chain / nullish
      else ternaries++;
    } else if (ch === ":") {
      if (ternaries > 0) ternaries--;
      else if (parens === 0) return false; // end of this ternary, no string branch
    }
  }
  return false;
}

const INLINE_RE = /(?:\blang\s*===?\s*["']bn["']|\bisBn\b)\s*\?/g;

function countInlineLangSites(txt, file) {
  const normalized = file.split("\\").join("/");
  if (normalized.endsWith("lib/i18n.ts")) return 0; // dictionary data is the target, not the debt
  if (/\.test\.(ts|tsx)$/.test(normalized)) return 0; // tests may pin either language
  const clean = stripComments(txt);
  let n = 0;
  for (const m of clean.matchAll(INLINE_RE)) {
    if (branchHasStringLiteral(clean, m.index + m[0].length)) n++;
  }
  return n;
}

const inlineSites = [];
let inlineTotal = 0;
for (const f of walk(SRC)) {
  const n = countInlineLangSites(readFileSync(f, "utf8"), f);
  if (n > 0) inlineSites.push([f.split("\\").join("/"), n]);
  inlineTotal += n;
}

// All declared dictionary keys (top-level `key: { ... }` entries).
const dictRaw = readFileSync(join(SRC, "lib/i18n.ts"), "utf8");
const declared = new Set([...dictRaw.matchAll(/^\s*([A-Za-z_][\w]*):\s*\{/gm)].map((m) => m[1]));

// All `t("key")` / t('key') usages across source.
const used = new Set();
for (const f of walk(SRC)) {
  const txt = readFileSync(f, "utf8");
  for (const m of txt.matchAll(/[^.\w]t\(\s*["']([\w]+)["']/g)) used.add(m[1]);
}

const missing = [...used].filter((k) => !declared.has(k));
const unused = [...declared].filter((k) => !used.has(k) && !["bn", "en"].includes(k));

let ok = true;
if (inlineTotal > INLINE_LANG_BASELINE) {
  ok = false;
  console.error(`✗ Inline language ternaries: ${inlineTotal} found, baseline ${INLINE_LANG_BASELINE}.`);
  console.error("  New inline `lang === \"bn\" ? \"…\" : \"…\"` copy must go through lib/i18n.ts");
  console.error("  (inline sites without string literals are not counted):");
  for (const [file, n] of inlineSites.sort((a, b) => b[1] - a[1])) console.error(`   - ${file}: ${n}`);
}
if (missing.length) {
  ok = false;
  console.error("✗ Missing i18n dictionary keys (used but not defined):");
  for (const k of missing) console.error("   - " + k);
}
if (unused.length) {
  console.warn("⚠ Unused i18n dictionary keys (defined but never t()-used):");
  for (const k of unused) console.warn("   - " + k);
}

if (ok) {
  console.log(`✓ i18n OK: ${used.size} keys referenced, ${declared.size} declared, 0 missing.`);
  console.log(`  inline language ternaries: ${inlineTotal} (ratchet baseline ${INLINE_LANG_BASELINE}, grandfathered debt — lower as files migrate).`);
  process.exit(0);
} else {
  process.exit(1);
}
