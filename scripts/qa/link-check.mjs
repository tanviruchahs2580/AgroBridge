#!/usr/bin/env node
/**
 * Link check for the documentation that ships in the repo: README.md and every
 * docs/**\/*.md, recursively.
 *
 * Fails when a RELATIVE link target does not exist on disk. Deliberately
 * skipped:
 *   - absolute URLs (http:, https:, mailto:, ...): they cannot be checked
 *     offline and a slow or blocked host must not fail the build;
 *   - anchors only (#section) and query strings;
 *   - fenced code blocks and inline code spans, where `[x](y)` is normally an
 *     example rather than a link.
 *
 * A target keeps its fragment stripped (docs/adr/0001.md#rules →
 * docs/adr/0001.md) and is percent-decoded, so links to paths with spaces
 * resolve. Both inline links and reference definitions (`[label]: target`) are
 * checked.
 *
 * Usage: node scripts/qa/link-check.mjs
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** README.md plus docs/**\/*.md — the only trees this gate owns. */
function markdownFiles() {
  const files = [];
  const readme = join(root, "README.md");
  if (existsSync(readme)) files.push(readme);

  const docs = join(root, "docs");
  if (existsSync(docs)) {
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(full);
      }
    };
    walk(docs);
  }
  return files;
}

// [label](target "title") — the negative lookbehind keeps image sources out,
// images are assets rather than documentation links.
const INLINE_LINK = /(?<!!)\[[^\]]*\]\(\s*(<[^>\n]*>|[^()\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
// [label]: target
const LINK_DEFINITION = /^\s*\[[^\]]+\]:\s*(\S+)/;
// ^ scheme or protocol-relative: not ours to check
const SKIP_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const FENCE = /^\s*(?:```|~~~)/;

const problems = [];
let checked = 0;

function checkTarget(file, lineNumber, target) {
  const raw = target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1) : target;
  if (!raw || raw.startsWith("#") || SKIP_SCHEME.test(raw)) return;

  const withoutFragment = raw.split("#")[0].split("?")[0];
  if (!withoutFragment) return;

  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // malformed escape: fall through and look for the literal path
  }

  checked += 1;
  if (!existsSync(resolve(dirname(file), decoded))) {
    problems.push({ file: relative(root, file), line: lineNumber, target: raw });
  }
}

for (const file of markdownFiles()) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let inFence = false;

  lines.forEach((line, index) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    // Inline code spans are examples, not links.
    const text = line.replace(/`[^`]*`/g, "");

    for (const match of text.matchAll(INLINE_LINK)) {
      checkTarget(file, index + 1, match[1]);
    }
    const definition = text.match(LINK_DEFINITION);
    if (definition) checkTarget(file, index + 1, definition[1]);
  });
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`missing link target: ${problem.file}:${problem.line} -> ${problem.target}`);
  }
  console.error(`\n${problems.length} broken link(s) out of ${checked} relative targets checked`);
  process.exit(1);
}

console.log(`Docs link check clean (${checked} relative targets resolved)`);
