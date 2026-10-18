import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Environment parity guard (J-04).
 *
 * `.env.example` is the operator-facing contract: a variable that code reads but
 * the template never mentions is a variable nobody can discover, and a variable
 * the template advertises but no code reads is a trap that wastes an operator's
 * afternoon (the repository already carries `API_BASE_URL`'s ghost story in
 * .env.example's own comments). Both drifts are silent in every other gate, so
 * this test walks the code like a build does and compares both directions.
 *
 * Scope: `process.env.<NAME>` / `process.env["<NAME>"]` reads in apps/api/src,
 * plus the keys of the zod schema in src/config/env.ts — `schema.safeParse(
 * process.env)` reads all of them and is how most configuration is consumed.
 *
 * Reads are quoted with file:line so the failure message points at the code
 * that must change, not just the name.
 */

const apiRoot = fileURLToPath(new URL("..", import.meta.url)); // apps/api/
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url)); // repo root
const SRC = join(apiRoot, "src");
const ENV_EXAMPLE = join(repoRoot, ".env.example");
const ENV_SCHEMA = join(SRC, "config", "env.ts");

/**
 * Variables the code reads on purpose without requiring an .env.example entry.
 * Every entry states why — an empty "reason" here would be how this allowlist
 * becomes decoration.
 */
const READ_WITHOUT_TEMPLATE_ENTRY: Record<string, string> = {
  VERCEL_GIT_COMMIT_SHA:
    "Vercel platform-injected (Git-integration + CLI deploys); read by app.ts only to report the deployed commit on /health. Never operator-set.",
  GIT_COMMIT:
    "Fallback for non-Vercel runtimes (app.ts); same deployment-metadata role as VERCEL_GIT_COMMIT_SHA.",
};

/**
 * Variables `.env.example` documents that the API never reads, kept because
 * another consumer genuinely uses them. Removing them from the template would
 * make the web/APK build inputs undiscoverable.
 */
const TEMPLATE_ENTRY_WITHOUT_API_READ: Record<string, string> = {
  VITE_API_BASE_URL:
    "Web/APK build input — the Vite bundler and Capacitor builds read it (apps/web), the API never does.",
  VITE_FEATURE_NEW_SHELL: "Web bundle feature switch (apps/web).",
  VITE_FEATURE_ONBOARDING: "Web bundle feature switch (apps/web).",
};

/**
 * Named exceptions the audit calls out explicitly, with the reason each one is
 * allowed to sit outside the "read ⇒ documented" relationship. This map is
 * documentation-first: the test itself only needs the two allowlists above, but
 * a future reader must not have to rediscover why these names behave the way
 * they do.
 */
export const PROCESS_ENV_EXCEPTIONS: Record<string, string> = {
  NODE_ENV:
    "Runtime mode set by the launcher/CI, not by .env (documented in .env.example for completeness). Guarding production behaviour must never depend on the operator remembering it.",
  ALLOW_PLACEHOLDER_PROVIDERS:
    "Operational escape hatch checked directly (config/env.ts) so the fail-fast path cannot be bypassed by schema defaults; ships commented-out in .env.example by design.",
  ALLOW_DEV_ORIGINS:
    "Dev-only CORS hatch for the local docker stack; commented out in .env.example so it cannot be enabled by copy-paste.",
  ALLOW_DEMO_SEED:
    "Seed-only flag read by apps/api/prisma/seed.ts (outside src, hence outside this test's scan); never read by the API at runtime.",
  LOG_LEVEL: "Runtime log level; read directly by shared/logging/logger.ts with a safe default.",
  UPLOAD_BASE_DIR:
    "Filesystem path override read by providers/storage/local.ts; ships commented out (default: <cwd>/uploads).",
  "PG*/POSTGRES_*": "Platform-injected by Neon/Vercel and the compose db service; Prisma reads DATABASE_URL itself, code never touches PG* names.",
  "CI-only vars": "ci.yml sets values for DATABASE_URL/JWT_*/LOGIN_RATE_LIMIT_MAX — the same documented variables, scoped to a throwaway instance.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(p)) out.push(p);
  }
  return out;
}

/** All `process.env.X` / `process.env["X"]` reads, quoted with file:line. */
function directReads(files: string[]): Map<string, string[]> {
  const reads = new Map<string, string[]>();
  const patterns = [/process\.env\.([A-Z][A-Z0-9_]*)/g, /process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of patterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          const where = `${file.slice(repoRoot.length).replace(/\\/g, "/")}:${i + 1}`;
          reads.set(m[1]!, [...(reads.get(m[1]!) ?? []), where]);
        }
      }
    });
  }
  return reads;
}

/**
 * Keys of the zod object in config/env.ts (2-space-indented `NAME:` lines inside
 * the `z.object({...})` literal) — `schema.safeParse(process.env)` consumes every
 * one of them, so they are reads in every sense that matters.
 */
function schemaKeys(): string[] {
  const src = readFileSync(ENV_SCHEMA, "utf8");
  const start = src.indexOf("z.object({");
  const block = src.slice(start, src.indexOf("});", start));
  return [...block.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);
}

/** Names .env.example mentions — active OR commented-out (`# NAME=` still documents it). */
function documentedNames(): string[] {
  const src = readFileSync(ENV_EXAMPLE, "utf8");
  return [...src.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!);
}

const srcFiles = walk(SRC);
const readMap = directReads(srcFiles);
for (const key of schemaKeys()) {
  readMap.set(key, [...(readMap.get(key) ?? []), "src/config/env.ts (zod schema — safeParse(process.env))"]);
}

const read = new Set(readMap.keys());
const documented = new Set(documentedNames());

describe("env parity — code reads vs .env.example", () => {
  it("every variable the API reads is documented in .env.example", () => {
    const undocumented = [...read].filter((n) => !documented.has(n) && !(n in READ_WITHOUT_TEMPLATE_ENTRY)).sort();
    const message =
      `Variable(s) read by apps/api/src but not documented in .env.example:\n` +
      undocumented.map((n) => `  - ${n} — read at ${readMap.get(n)!.join(", ")}`).join("\n") +
      (undocumented.length
        ? `\nFix: add the name (a commented-out line like "# NAME=" counts) to .env.example, OR add it to ` +
          `READ_WITHOUT_TEMPLATE_ENTRY in this test with a reason (currently allowlisted: ` +
          `${Object.keys(READ_WITHOUT_TEMPLATE_ENTRY).join(", ")}).\n` +
          `Intentional-exception register (PROCESS_ENV_EXCEPTIONS): ${Object.keys(PROCESS_ENV_EXCEPTIONS).join(", ")}`
        : "");
    expect(undocumented, message).toEqual([]);
  });

  it("every variable .env.example documents is read by the API (or owned by another consumer)", () => {
    const unread = [...documented]
      .filter((n) => !read.has(n) && !(n in TEMPLATE_ENTRY_WITHOUT_API_READ))
      .sort();
    const message =
      `Variable(s) in .env.example that no code in apps/api/src reads:\n` +
      unread.map((n) => `  - ${n}`).join("\n") +
      (unread.length
        ? `\nFix: delete the name from .env.example (a variable nobody reads misleads operators), OR add it to ` +
          `TEMPLATE_ENTRY_WITHOUT_API_READ in this test naming the consumer that does read it ` +
          `(currently allowlisted: ${Object.keys(TEMPLATE_ENTRY_WITHOUT_API_READ).join(", ")}).`
        : "");
    expect(unread, message).toEqual([]);
  });

  it("the scan itself is not vacuous", () => {
    // A refactor that moved config out of src or renamed .env.example must fail
    // loudly here instead of silently comparing two empty sets.
    expect(read.size).toBeGreaterThan(20);
    expect(documented.size).toBeGreaterThan(20);
  });
});
