import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RESOURCE_KEYS } from "./resourceKeys";

/**
 * Cache identity is a correctness property, not a naming preference.
 *
 * `invalidate(key)` matches exactly, so a screen that fetches a shared endpoint
 * under its own private key cannot be refreshed by a mutation elsewhere — it just
 * keeps rendering what it fetched first. This guard is the enforcement half of
 * `resourceKeys.ts`: any feature file that reads a shared endpoint must use the
 * shared key for it.
 *
 * It is deliberately a source-level check, like the repo's i18n and
 * response-shape guards: a future screen added with `useResource("farms-again", …)`
 * compiles, passes every journey test, and silently reintroduces the bug.
 */
// cwd-relative, like scripts/i18n-check.mjs: vitest runs with the package root as
// its working directory (CI sets `working-directory: apps/web`), and
// `import.meta.url` is not a file: URL under the jsdom environment.
const FEATURES_DIR = join("src", "features");

/** endpoint path → the key every consumer of it must use. */
const SHARED_ENDPOINTS: Array<[string, string]> = [
  ['"GET", "/farms"', RESOURCE_KEYS.farms],
  // Added with the keys themselves: Home read weather as `"home-weather"` while
  // My Farm invalidated `"weather"`, and Home read notifications as
  // `"home-notifications"` while the notifications screen invalidated
  // `"notifications"` — two cross-screen refreshes that could never fire, and the
  // guard above only covered `/farms`, so nothing caught either.
  ['"GET", `/weather', RESOURCE_KEYS.weather],
  ['"GET", "/notifications"', RESOURCE_KEYS.notifications],
];

function featureFiles(dir: string = FEATURES_DIR): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return featureFiles(full);
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

describe("resource keys are shared, not re-invented", () => {
  for (const [endpoint, key] of SHARED_ENDPOINTS) {
    it(`every consumer of ${endpoint} uses the shared key "${key}"`, () => {
      const offenders = featureFiles()
        .filter((f) => readFileSync(f, "utf8").includes(endpoint))
        .filter((f) => !readFileSync(f, "utf8").includes(`RESOURCE_KEYS.${key}`))
        .map((f) => f.slice(FEATURES_DIR.length + 1).split("\\").join("/"));

      expect(
        offenders,
        `These files fetch ${endpoint} without using RESOURCE_KEYS.${key}, so a mutation ` +
          `elsewhere cannot invalidate them: ${offenders.join(", ")}`
      ).toEqual([]);
    });
  }

  /**
   * The other half of the rule: a key that is *invalidated* but never subscribed to
   * is a no-op. `Services.tsx` called `invalidate("services-farms")` — a name no
   * resource ever registered — so creating a booking silently left the farm list
   * stale while the comment above it claimed all three families were invalidated.
   */
  it("every invalidate() target is a key some resource actually registers", () => {
    const files = featureFiles();
    const registered = new Set<string>();
    const invalidated = new Map<string, string[]>();

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const rel = file.slice(FEATURES_DIR.length + 1).split("\\").join("/");
      // useResource(<key>, …) — the first argument, literal or RESOURCE_KEYS.x
      for (const m of source.matchAll(/useResource<[^>]*>\(\s*(?:"([^"]+)"|RESOURCE_KEYS\.(\w+))/g)) {
        registered.add(m[1] ?? RESOURCE_KEYS[m[2] as keyof typeof RESOURCE_KEYS]);
      }
      for (const m of source.matchAll(/invalidate\(\s*(?:"([^"]+)"|RESOURCE_KEYS\.(\w+))/g)) {
        const key = m[1] ?? RESOURCE_KEYS[m[2] as keyof typeof RESOURCE_KEYS];
        invalidated.set(key, [...(invalidated.get(key) ?? []), rel]);
      }
    }

    const dead = [...invalidated.entries()]
      .filter(([key]) => !registered.has(key))
      .map(([key, where]) => `${key} (${where.join(", ")})`);

    expect(
      dead,
      `invalidate() called with keys no resource registers — the call cannot refresh anything: ${dead.join("; ")}`
    ).toEqual([]);
  });
});
