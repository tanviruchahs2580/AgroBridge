#!/usr/bin/env node
/**
 * Link check for the repository documentation: README.md, AGENTS.md,
 * CONTRIBUTING.md, CHANGELOG.md, the root policy files, and every docs/**\/*.md.
 *
 * F-46: targets are resolved against the **tracked file set** (`git ls-files`),
 * not the working tree. `existsSync` could not see the difference between a
 * committed file and an untracked/gitignored one, so ~30 tracked documents
 * linked into an untracked `.audit/**` tree and the gate stayed green while
 * every other clone 404'd. The tracked set is what a reader of the repository
 * actually receives. Same discipline as tests/import-boundaries.test.ts
 * ("so untracked scratch files cannot weaken it").
 *
 * F-47: the gate used to own only README.md + docs/**; it now also covers the
 * root documents that carry the load-bearing claims (AGENTS.md, CONTRIBUTING.md,
 * CHANGELOG.md, PRIVACY_POLICY.md, TERMS_OF_SERVICE.md, SECURITY.md). A source
 * that is not tracked yet (locally created, not committed) is reported and
 * skipped — the tracked artifact is what this gate verifies.
 *
 * Fails when a RELATIVE link target is not tracked. Deliberately skipped:
 *   - absolute URLs (http:, https:, mailto:, ...): they cannot be checked
 *     offline and a slow or blocked host must not fail the build;
 *   - anchors only (#section) and query strings;
 *   - fenced code blocks and inline code spans, where `[x](y)` is normally an
 *     example rather than a link.
 *
 * A target keeps its fragment stripped (docs/adr/0001.md#rules →
 * docs/adr/0001.md) and is percent-decoded, so links to paths with spaces
 * resolve. Both inline links and reference definitions (`[label]: target`) are
 * checked. A link to a directory is valid when at least one tracked file lives
 * under it.
 *
 * Usage: node scripts/qa/link-check.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The tracked file set — the artifact a reader of the repository receives. */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return new Set(out.split("\0").filter(Boolean));
}

const tracked = trackedFiles();
/** Every directory prefix that contains a tracked file (links may target a dir). */
const trackedDirs = new Set();
for (const file of tracked) {
  for (let i = file.indexOf("/"); i !== -1; i = file.indexOf("/", i + 1)) {
    trackedDirs.add(file.slice(0, i));
  }
}

/** Root-level documents this gate owns (F-47), each only if tracked. */
const ROOT_DOCS = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "CHANGELOG.md", "PRIVACY_POLICY.md", "TERMS_OF_SERVICE.md", "SECURITY.md"];

function markdownFiles() {
  const files = [];
  for (const name of ROOT_DOCS) {
    const full = join(root, name);
    if (!tracked.has(name)) {
      if (existsSync(full)) console.log(`link-check: skipped (not tracked): ${name}`);
      continue;
    }
    files.push(full);
  }

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
  return files.filter((file) => tracked.has(relative(root, file).split(sep).join("/")));
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
  const absolute = resolve(dirname(file), decoded);
  const rel = relative(root, absolute).split(sep).join("/").replace(/\/+$/, "");
  if (tracked.has(rel) || trackedDirs.has(rel)) return;

  problems.push({
    file: relative(root, file).split(sep).join("/"),
    line: lineNumber,
    target: raw,
    // A target that exists on disk but is untracked is the F-46 class: it
    // passes locally and 404s for everyone else.
    kind: existsSync(absolute) ? "untracked" : "missing",
  });
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
    console.error(`${problem.kind === "untracked" ? "untracked" : "missing"} link target: ${problem.file}:${problem.line} -> ${problem.target}`);
  }
  console.error(`\n${problems.length} broken link(s) out of ${checked} relative targets checked`);
  process.exit(1);
}

console.log(`Docs link check clean (${checked} relative targets resolved against the tracked file set)`);
