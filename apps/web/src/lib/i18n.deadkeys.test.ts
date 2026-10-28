import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Hard-zero ratchet: no dictionary key may be referenced nowhere.
 *
 * The dictionary ships inside the entry bundle, so a key kept "just in case" is weight every user
 * downloads. `scripts/i18n-check.mjs` reports unused keys but treats them as informational, and it
 * cannot tell a dead key from one reached indirectly (`ROLE_KEYS = { FARMER: "roleFARMER" }`) or
 * through a template (`t(\`withdrawMethod${ch}\`)`). This test applies the stricter rule: a key's
 * identifier must appear somewhere in `apps/web/src` outside the dictionary itself — which covers
 * both direct calls and map values — and any key that appears nowhere fails the suite.
 *
 * 68 such keys had accumulated (5.4 kB of Bengali and English copy, ~1.9 kB gzipped in the entry
 * bundle) before they were removed on 2026-10-28. This test is what keeps that number at zero.
 *
 * When it fails, the fix is usually deletion. If the key really is reached in a way this scan cannot
 * see, reference it by name from the code that uses it instead of widening the scan.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");
const DICTIONARY = path.join(srcRoot, "lib", "i18n.ts");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

describe("i18n dictionary", () => {
  it("has no key that nothing references", () => {
    const dictionary = readFileSync(DICTIONARY, "utf8");
    const keys = [...dictionary.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*):\s*\{\s*bn:/gm)].map((m) => m[1]!);

    const others = sourceFiles(srcRoot)
      .filter((f) => path.normalize(f) !== path.normalize(DICTIONARY))
      .map((f) => readFileSync(f, "utf8"));

    const dead = keys.filter((key) => {
      const word = new RegExp(`\\b${key}\\b`);
      return !others.some((text) => word.test(text));
    });

    expect(
      dead,
      `dictionary keys referenced nowhere — delete them, or reference them by name where they are used:\n${dead.join("\n")}`
    ).toEqual([]);
  });

  it("still carries the keys the app actually asks for", () => {
    // Guard the guard: a scan that found no keys at all would pass the test above.
    const dictionary = readFileSync(DICTIONARY, "utf8");
    const keys = [...dictionary.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*):\s*\{\s*bn:/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(400);
    expect(keys).toContain("appName");
    expect(keys).toContain("roleREGIONAL_MANAGER");
  });
});
