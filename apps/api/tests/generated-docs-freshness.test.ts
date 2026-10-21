import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Freshness gate for the generated reference docs.
 *
 * docs/env-reference.md and docs/erd.md are rendered from source by the
 * scripts named in each file's header. Committing generated output is what
 * makes it reviewable in a diff; the cost is that it can go stale, so each
 * doc is re-rendered here and compared byte-for-byte. The generators are
 * deterministic (source order, no timestamps, repo-relative paths only) —
 * if that ever stops being true, this test fails rather than producing churn.
 *
 * The generator modules are plain ESM scripts (they must run with bare
 * `node`); the specifiers live in string variables so TypeScript does not try
 * to typecheck the .mjs files against this tsconfig.
 */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

type EnvReferenceModule = { buildEnvReference: () => string };
type ErdModule = { buildErd: () => string };

async function loadEnvGenerator(): Promise<EnvReferenceModule> {
  const specifier: string = new URL("../scripts/generate-env-reference.mjs", import.meta.url).href;
  return (await import(specifier)) as EnvReferenceModule;
}

async function loadErdGenerator(): Promise<ErdModule> {
  const specifier: string = new URL("../scripts/generate-erd.mjs", import.meta.url).href;
  return (await import(specifier)) as ErdModule;
}

describe("generated docs freshness", () => {
  it("docs/env-reference.md matches a fresh render of config/env.ts + .env.example", async () => {
    const { buildEnvReference } = await loadEnvGenerator();
    const fresh = buildEnvReference();
    const committed = readFileSync(`${repoRoot}docs/env-reference.md`, "utf8");
    expect(
      committed,
      "docs/env-reference.md is stale — regenerate with: node apps/api/scripts/generate-env-reference.mjs",
    ).toBe(fresh);
  });

  it("docs/erd.md matches a fresh render of the PostgreSQL schema", async () => {
    const { buildErd } = await loadErdGenerator();
    const fresh = buildErd();
    const committed = readFileSync(`${repoRoot}docs/erd.md`, "utf8");
    expect(
      committed,
      "docs/erd.md is stale — regenerate with: node apps/api/scripts/generate-erd.mjs",
    ).toBe(fresh);
  });

  it("the renders are not vacuous", async () => {
    const { buildEnvReference } = await loadEnvGenerator();
    const { buildErd } = await loadErdGenerator();
    const envRows = [...buildEnvReference().matchAll(/^\| `[A-Z][A-Z0-9_]*` \|/gm)].length;
    const models = [...buildErd().matchAll(/^ {2}[A-Z][A-Za-z]* \{$/gm)].length;
    expect(envRows).toBeGreaterThanOrEqual(35);
    expect(buildErd()).toContain("erDiagram");
    expect(models).toBeGreaterThanOrEqual(25);
  });
});
