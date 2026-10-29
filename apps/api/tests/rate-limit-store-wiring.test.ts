import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Rate-limit store wiring — the invariants that only bite when REDIS_URL is set.
 *
 * express-rate-limit asks its store to count a key derived **only from the request**,
 * and it refuses a Store instance that two limiters use: `unsharedStore()` raises
 * ERR_ERL_STORE_REUSE on the first request through the second limiter, which surfaces
 * as a 500 rather than as a rate-limited response. Both failure modes are invisible
 * locally, because with no REDIS_URL every limiter falls back to its own in-memory
 * store and neither the sharing nor the key collision can happen.
 *
 * That is exactly how `otpStore` came to be shared by four limiters (OTP request,
 * OTP verify, password forgot, password reset): CI never sets REDIS_URL either, so
 * nothing failed until a multi-instance deployment configured Redis — and then the
 * whole password-recovery path answered 500.
 *
 * These tests read the source rather than booting the app, so they hold for every
 * limiter in the codebase, including ones added later.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..", "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = sourceFiles(srcRoot).map((p) => ({ rel: path.relative(srcRoot, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));
const STORE_FACTORY = "infrastructure/rateLimitRedis.ts";

describe("rate-limit store wiring (API-8 / FND-010)", () => {
  it("no Store instance is referenced by more than one limiter", () => {
    // A store passed to two `rateLimit` instances makes the second one 500.
    const offenders: string[] = [];
    for (const f of files) {
      if (f.rel === STORE_FACTORY) continue;
      const refs = [...f.text.matchAll(/store:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
      const seen = new Map<string, number>();
      for (const r of refs) seen.set(r, (seen.get(r) ?? 0) + 1);
      for (const [name, count] of seen) {
        if (count > 1) offenders.push(`${f.rel}: ${name} is used by ${count} limiters`);
      }
    }
    expect(
      offenders,
      `a rate-limit store must have exactly one owner — sharing one raises ERR_ERL_STORE_REUSE (500) on the second limiter's first request:${offenders.length ? "\n" + offenders.join("\n") : ""}`
    ).toEqual([]);
  });

  it("every Redis store is namespaced, and no two limiters share a namespace", () => {
    const prefixes: { file: string; prefix: string }[] = [];
    const unnamespaced: string[] = [];

    for (const f of files) {
      if (f.rel === STORE_FACTORY) continue;
      for (const m of f.text.matchAll(/createRedisStore\(([^)]*)\)/g)) {
        const args = m[1];
        const literal = /,\s*"([^"]+)"\s*$/.exec(args);
        // A factory may forward its own `prefix` parameter (auth/routes.ts does);
        // every call of that factory is checked for a literal below.
        const forwards = /,\s*prefix\s*$/.test(args);
        if (literal) prefixes.push({ file: f.rel, prefix: literal[1] });
        else if (!forwards) unnamespaced.push(`${f.rel}: createRedisStore(${args.trim()})`);
      }
      for (const m of f.text.matchAll(/redisStoreFor\(\s*([^)]*)\)/g)) {
        const first = m[1].split(",")[0]?.trim() ?? "";
        const literal = /^"([^"]+)"$/.exec(first);
        if (literal) prefixes.push({ file: f.rel, prefix: literal[1] });
        else unnamespaced.push(`${f.rel}: redisStoreFor(${m[1].trim()}) — the prefix must be a literal at the call site`);
      }
    }

    expect(unnamespaced, `every store needs a key prefix — without one the limiters share a Redis counter:${unnamespaced.length ? "\n" + unnamespaced.join("\n") : ""}`).toEqual([]);

    const byPrefix = new Map<string, string[]>();
    for (const { file, prefix } of prefixes) byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file]);
    const collisions = [...byPrefix].filter(([, fs]) => fs.length > 1).map(([prefix, fs]) => `${prefix} → ${fs.join(", ")}`);
    expect(
      collisions,
      `two limiters share a Redis namespace and would enforce one budget between them:${collisions.length ? "\n" + collisions.join("\n") : ""}`
    ).toEqual([]);
    expect(prefixes.length).toBeGreaterThanOrEqual(6);
  });

  it("every limiter that names a window also names a store", () => {
    // A limiter without a store silently keeps an in-memory window, which is a
    // per-process budget: five exports an hour become five per instance.
    const offenders: string[] = [];
    for (const f of files) {
      if (f.rel === STORE_FACTORY) continue;
      const blocks = [...f.text.matchAll(/rateLimit\(\{[\s\S]*?\n\}\);/g)].map((m) => m[0]);
      for (const b of blocks) {
        if (!/\bstore\b/.test(b)) {
          const window = /windowMs:\s*([^,\n]+)/.exec(b)?.[1] ?? "?";
          offenders.push(`${f.rel}: limiter with windowMs ${window.trim()} has no store`);
        }
      }
    }
    expect(offenders, `limiters must declare a store (undefined/omitted is fine only with a comment):\n${offenders.join("\n")}`).toEqual([]);
  });
});
