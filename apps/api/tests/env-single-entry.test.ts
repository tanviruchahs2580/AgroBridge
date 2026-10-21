import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Configuration single-entry guard.
 *
 * Every runtime setting is read through `config/env.ts`, where it is parsed,
 * typed and defaulted by the zod schema — and where the production guards
 * live. A stray `process.env.X` read elsewhere bypasses all of that: the value
 * arrives unvalidated and, worse for operators, undocumented (the
 * `.env.example` parity test keys off the schema). This test walks
 * `apps/api/src/**` and fails on any direct read outside `config/env.ts`.
 *
 * Allowlist — platform-injected deployment metadata, never operator-set:
 *   - VERCEL_GIT_COMMIT_SHA: injected by Vercel for Git-integration and CLI
 *     deployments;
 *   - GIT_COMMIT: fallback for other runtimes.
 * app.ts reads them only to report the deployed commit on /health. They are
 * deliberately NOT schema keys: adding them would demand a .env.example entry
 * and advertise a knob nobody can meaningfully set.
 */

const apiRoot = fileURLToPath(new URL("..", import.meta.url)); // apps/api/
const SRC = join(apiRoot, "src");
const ENV_MODULE = join(SRC, "config", "env.ts");

const ALLOWED_READS = new Set(["VERCEL_GIT_COMMIT_SHA", "GIT_COMMIT"]);

/** `process.env.X`, `process.env["X"]`, or a bare `process.env` (whole object). */
const ENV_READ = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])?/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

interface DirectRead {
  file: string;
  line: number;
  name: string;
}

function directReads(files: string[]): DirectRead[] {
  const reads: DirectRead[] = [];
  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, index) => {
        ENV_READ.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = ENV_READ.exec(text))) {
          reads.push({
            file: file.slice(apiRoot.length).replace(/\\/g, "/"),
            line: index + 1,
            name: match[1] ?? match[2] ?? "(whole process.env object)",
          });
        }
      });
  }
  return reads;
}

const files = walk(SRC);

describe("configuration has a single entry (config/env.ts)", () => {
  it("no file other than config/env.ts reads process.env (allowlist: platform commit SHAs)", () => {
    const violations = directReads(files)
      .filter((r) => !r.file.endsWith("config/env.ts"))
      .filter((r) => !ALLOWED_READS.has(r.name));

    const message =
      `Direct process.env read(s) outside config/env.ts:\n` +
      violations.map((v) => `  - ${v.file}:${v.line} reads ${v.name}`).join("\n") +
      (violations.length
        ? `\nFix: add the variable to the zod schema in src/config/env.ts (with a safe default), ` +
          `document it in .env.example, and read it via \`env\`. ` +
          `Allowlisted platform-injected names: ${[...ALLOWED_READS].join(", ")}.`
        : "");
    expect(violations, message).toEqual([]);
  });

  it("the scan is not vacuous — config/env.ts itself reads the environment", () => {
    const envReads = directReads(files).filter((r) => r.file.endsWith("config/env.ts"));
    // `schema.safeParse(process.env)` is the whole point of the module; if a
    // refactor moved configuration elsewhere this assertion fails loudly
    // instead of the suite comparing empty sets.
    expect(envReads.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(30);
  });

  it("the previously direct-read variables are schema keys now", () => {
    // Pins the specific migration sites: these used to be process.env reads
    // scattered across the tree (logger, storage). Keep the list short and
    // meaningful — it is regression evidence, not a second schema.
    const schema = readFileSync(ENV_MODULE, "utf8");
    for (const name of ["LOG_LEVEL", "UPLOAD_BASE_DIR"]) {
      expect(schema, `${name} must be a config/env.ts schema key`).toMatch(new RegExp(`^\\s{2}${name}:`, "m"));
    }
  });
});
