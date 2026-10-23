#!/usr/bin/env node
/**
 * CLI for the dead-class scan (see scripts/lib/dead-classes.mjs).
 *
 *   node scripts/audit-dead-classes.mjs                 # scan every class in src/
 *   node scripts/audit-dead-classes.mjs bg-white/10 …   # probe specific classes
 *
 * Needs a production build first (`npm run build`) — it reads the compiled CSS.
 * The release preflight runs the same scan, so this exists for local use and for
 * probing a single class before changing a call site.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { builtCssPath, findDeadClasses, selectorExists } from "./lib/dead-classes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const WEB = join(HERE, ".."); // apps/web
const SRC = join(WEB, "src");

const cssPath = builtCssPath(join(WEB, "dist", "assets"));
if (!cssPath) {
  console.error("no CSS in dist/assets — run `npm run build` first");
  process.exit(1);
}
const cssText = readFileSync(cssPath, "utf8");

const probes = process.argv.slice(2);
if (probes.length > 0) {
  console.log(`CSS: ${cssPath}\n`);
  for (const cls of probes) {
    const alive = selectorExists(cssText, cls);
    const at = cssText.indexOf(`.${cls.replace(/([/.:])/g, "\\$1")}`);
    const rule = at < 0 ? "(no selector)" : `${cssText.slice(at, at + 80).split("{")[0]}{…}`;
    console.log(`  ${cls.padEnd(28)} ${alive ? "PRESENT" : "*** ABSENT ***"}  ${rule}`);
  }
  process.exit(0);
}

const { checked, dead } = findDeadClasses({ cssText, srcDir: SRC });
console.log(`CSS: ${cssPath}`);
console.log(`class tokens checked: ${checked} | emitting no CSS: ${dead.length}`);
for (const { cls, files } of dead) console.log(`  ${cls.padEnd(30)} <- ${files.join(", ")}`);
process.exit(dead.length ? 1 : 0);
