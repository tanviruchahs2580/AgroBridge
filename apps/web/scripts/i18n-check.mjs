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
  process.exit(0);
} else {
  process.exit(1);
}
