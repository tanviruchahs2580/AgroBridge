import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * F-77: the dev-only auth shortcuts (phone auto-verification at registration,
 * OTP code echoed as `devCode`) must require an EXPLICIT opt-in, not merely
 * "NODE_ENV is not production".
 *
 * `NODE_ENV` defaults to `development`, so a deployment that forgot to set it
 * previously created pre-verified accounts and returned every OTP in the API
 * response — an OTP bypass reachable by operator omission. This suite pins the
 * two-condition rule and the three call sites that depend on it, so a future
 * refactor back to `!isProd` fails here instead of shipping silently.
 *
 * These are static-source assertions (the module reads `process.env` at import
 * time, and re-importing it with a mutated environment would poison the env
 * object every other suite shares). The predicate itself is pure and is
 * asserted directly in the unit below.
 */
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const ENV_TS = path.join(apiRoot, "src", "config", "env.ts");
const AUTH_TS = path.join(apiRoot, "src", "modules", "auth", "routes.ts");

describe("dev auth shortcuts are an explicit opt-in (F-77)", () => {
  it("the env schema declares DEV_AUTH_SHORTCUTS as an enum, not a boolean-ish string", () => {
    const src = readFileSync(ENV_TS, "utf8");
    expect(src).toMatch(/DEV_AUTH_SHORTCUTS:\s*z\.enum\(\["0", "1"\]\)/);
    // The predicate must require BOTH conditions; a one-sided check is the bug.
    const predicate = /export function devAuthShortcutsEnabled[\s\S]*?\n}/.exec(src)?.[0] ?? "";
    expect(predicate).toContain('cfg.NODE_ENV !== "production"');
    expect(predicate).toContain('cfg.DEV_AUTH_SHORTCUTS === "1"');
  });

  it("every auth shortcut call site depends on the opt-in, and no site uses `!isProd` for it", () => {
    const src = readFileSync(AUTH_TS, "utf8");
    // Registration auto-verification.
    expect(src).toContain("phoneVerified: devAuthShortcuts");
    expect(src).not.toContain("phoneVerified: !isProd");
    // The two OTP echoes.
    expect(src).not.toMatch(/isProd \? \{\} : \{ devCode/);
    expect(src).toContain("devAuthShortcuts ? { devCode: code } : {}");
    expect(src).toContain('devAuthShortcuts ? { devCode: env.SMS_PROVIDER === "none" ? undefined : code } : {}');
  });

  it("the predicate enables shortcuts only for 'not production AND explicitly opted in'", async () => {
    const { devAuthShortcutsEnabled } = await import("../src/config/env.js");
    // The missing-NODE_ENV production accident: the schema defaults NODE_ENV to
    // "development", which is why the switch must ALSO be set. Without it the
    // shortcut stays off even though the mode is not production.
    expect(devAuthShortcutsEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devAuthShortcutsEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(devAuthShortcutsEnabled({ DEV_AUTH_SHORTCUTS: "1" })).toBe(true);
    expect(devAuthShortcutsEnabled({})).toBe(false);
    // The deliberate dev/test opt-in.
    expect(devAuthShortcutsEnabled({ NODE_ENV: "development", DEV_AUTH_SHORTCUTS: "1" })).toBe(true);
    expect(devAuthShortcutsEnabled({ NODE_ENV: "test", DEV_AUTH_SHORTCUTS: "1" })).toBe(true);
    // Production can never opt in — the flag is not an override of production.
    expect(devAuthShortcutsEnabled({ NODE_ENV: "production", DEV_AUTH_SHORTCUTS: "1" })).toBe(false);
  });

  it("the test suite and .env.example both carry the switch explicitly", () => {
    const setup = readFileSync(path.join(apiRoot, "tests", "setup-env.ts"), "utf8");
    expect(setup, "tests must opt in explicitly rather than inheriting a default").toContain('process.env.DEV_AUTH_SHORTCUTS = process.env.DEV_AUTH_SHORTCUTS ?? "1"');
    const example = readFileSync(path.resolve(apiRoot, "..", "..", ".env.example"), "utf8");
    expect(example).toContain("DEV_AUTH_SHORTCUTS");
    // The template documents it commented-out so a copy-paste cannot enable it.
    expect(example).toMatch(/^#\s*DEV_AUTH_SHORTCUTS=1$/m);
  });
});
