/**
 * Finds Tailwind classes used in `src/` that emit no CSS in the compiled build.
 *
 * A class that does not exist in `tailwind.config.js` produces no rule, so the
 * element renders unstyled while the build stays green. Three such classes shipped
 * at HEAD and were invisible to lint, typecheck, unit tests, E2E and axe:
 *
 *   bg-surface-card-subdued  (the token is spelled `surface.subdued` → bg-surface-subdued)
 *   bg-warning               (the `warning` group has no DEFAULT key)
 *   decoration-link/40       (a bare `var(--color-*)` cannot take an opacity modifier)
 *
 * Exported for both the `audit-dead-classes.mjs` CLI (which can probe individual
 * class names) and the release preflight, which runs it against the built CSS.
 */
import fs from "node:fs";
import path from "node:path";

const PREFIXES = [
  "bg", "text", "border", "ring", "fill", "stroke", "shadow",
  "from", "via", "to", "divide", "placeholder", "outline",
  "decoration", "accent", "caret",
];

const VARIANT = /^(hover|focus|focus-visible|focus-within|active|disabled|visited|target|first|last|only|odd|even|empty|checked|indeterminate|default|required|valid|invalid|in-range|out-of-range|placeholder-shown|autofill|read-only|group-hover|group-focus-within|group-focus|peer-focus|peer-checked|peer-disabled|sm|md|lg|xl|2xl|motion-reduce|motion-safe|print|rtl|ltr|before|after|file|open|aria-[a-z-]+|data-[^:]+):/;

/** Strip a token down to a bare class candidate, or return "" when it is not one. */
function normalizeToken(token) {
  return token
    .replace(/^[^a-zA-Z]+/, "")
    .replace(/[^a-zA-Z0-9/_.:-]+$/, "");
}

/**
 * Comments are removed before scanning. The source documents several fixes by
 * naming the class it replaced (`bg-warning`, `decoration-link/40`), and without
 * this the check reported its own documentation as dead code. Whole-line comments
 * plus JSX `{/* … *\/}` blocks are enough for a static scan; a naive `//` strip
 * would truncate URLs inside string literals.
 */
function stripComments(source) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
    })
    .join("\n");
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(p, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** Every class-shaped token in `srcDir`, mapped to the files it appears in. */
export function collectClassTokens(srcDir) {
  const found = new Map();
  for (const file of walk(srcDir)) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    // A class name in JSX is usually a plain string, but conditional classes are
    // written as `` `base ${cond ? "bg-warning" : "bg-brand-400"}` `` — so a token
    // arrives wrapped in quotes and JS punctuation.
    const literals = [...src.matchAll(/"([^"\n]*)"|`([^`\n]*)`|'([^'\n]*)'/g)].map(
      (m) => m[1] ?? m[2] ?? m[3] ?? "",
    );
    for (const literal of literals) {
      for (const raw of literal.split(/\s+/)) {
        let base = normalizeToken(raw.trim());
        if (!base) continue;
        while (VARIANT.test(base)) base = normalizeToken(base.replace(VARIANT, ""));
        if (!base || /[[\]${}%"]/.test(base)) continue;
        // Only `prefix-suffix` shapes are checked. JSX ternaries glue `:` between
        // two class strings with no whitespace, and prose contains words like
        // "from" and "to"; the risk this targets is a misspelled token name, not
        // the handful of suffix-less utilities (`border`, `ring`, `shadow`).
        if (!PREFIXES.some((p) => base.startsWith(`${p}-`))) continue;
        if (!found.has(base)) found.set(base, new Set());
        found.get(base).add(path.relative(srcDir, file).split(path.sep).join("/"));
      }
    }
  }
  return found;
}

/**
 * Characters that need a backslash in a CSS selector fragment. Tailwind escapes
 * `/`, `.` and `:` in the class names it emits (`.bg-white\/10`, `.hover\:bg-x`),
 * and the rest are regex metacharacters the caller must not be able to smuggle in.
 */
const SELECTOR_SPECIAL = "\\/.:*+?^$(){}[]|";

/**
 * Escape a class name into a CSS selector fragment, in **one** pass over a single
 * character map.
 *
 * The previous version escaped twice: `replace(/([/.:])/g, "\\$1")` inserted
 * backslashes and a second `replace` then re-escaped those same backslashes. It
 * happened to match because the regex engine read the doubled escape back down to
 * one, but the result depended on pass order and a class name that already
 * contained a backslash would have compounded. CodeQL was right to flag it
 * (`js/double-escaping`, `js/incomplete-sanitization` on both this file and the
 * CLI that copied the expression) — a scanner that mis-escapes is a scanner that
 * silently reports clean.
 */
export function escapeForSelector(cls) {
  let out = "";
  for (const ch of cls) out += SELECTOR_SPECIAL.includes(ch) ? `\\${ch}` : ch;
  return out;
}

/** A character that may continue a class name — used to reject prefix matches. */
const NAME_CHAR = /[A-Za-z0-9_-]/;

/**
 * True when the compiled CSS contains the class's selector, plain or behind any
 * number of variants.
 *
 * Deliberately **not** built as a dynamic `RegExp` from the class name: the name
 * comes from source files, and interpolating it into a pattern is what made the
 * escaping subtle in the first place. Plain string searching plus an explicit
 * boundary check has no escape rules to get wrong.
 *
 * The name must be preceded by `.` (`.bg-surface-subdued`) or by a variant
 * separator (`\:`, as in `.hover\:bg-action-hover`), and must not be continued by
 * another name character — that trailing guard is exactly what separates
 * `.bg-warning` (dead) from `.bg-warning-bg` (a different, live class).
 */
export function selectorExists(css, cls) {
  const needle = escapeForSelector(cls);
  for (let i = css.indexOf(needle); i !== -1; i = css.indexOf(needle, i + 1)) {
    const before = css[i - 1];
    const precededByDot = before === ".";
    const precededByVariant = before === ":" && css[i - 2] === "\\";
    if (!precededByDot && !precededByVariant) continue;
    const after = css[i + needle.length];
    if (after === undefined || !NAME_CHAR.test(after)) return true;
  }
  return false;
}

/** @returns {{ checked: number, dead: { cls: string, files: string[] }[] }} */
export function findDeadClasses({ cssText, srcDir }) {
  const found = collectClassTokens(srcDir);
  const dead = [];
  for (const [cls, files] of found) {
    if (!selectorExists(cssText, cls)) dead.push({ cls, files: [...files].sort() });
  }
  dead.sort((a, b) => a.cls.localeCompare(b.cls));
  return { checked: found.size, dead };
}

/** The largest stylesheet Vite emitted, which is the app's own bundle. */
export function builtCssPath(distAssetsDir) {
  const files = fs
    .readdirSync(distAssetsDir)
    .filter((f) => f.endsWith(".css"))
    .sort((a, b) => fs.statSync(path.join(distAssetsDir, b)).size - fs.statSync(path.join(distAssetsDir, a)).size);
  return files.length ? path.join(distAssetsDir, files[0]) : null;
}
