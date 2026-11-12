import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Drift guard for the operator script that provisions a non-seeded account on a
 * live deployment (`scripts/play/create-reviewer-account.mjs`, referenced by
 * docs/play/reviewer-access.md and the launch checklist).
 *
 * The script is plain ESM run by an operator, so nothing type-checks it against
 * the API's request schemas. It silently broke once already: `/auth/register`
 * began requiring a literal `consent: true` (PRD-05/AUD-150) and the script kept
 * posting the old body, so every run failed with 400 before creating an account.
 * The same fix also had to learn that a taken phone answers `200
 * {needsLogin:true}` rather than a 409.
 *
 * This test reads both files as text and asserts the contract they share, so the
 * next change to either side fails a gate instead of surfacing on a live deploy.
 */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const scriptSource = readFileSync(`${repoRoot}scripts/play/create-reviewer-account.mjs`, "utf8");
const authRoutes = readFileSync(`${repoRoot}apps/api/src/modules/auth/routes.ts`, "utf8");

describe("create-reviewer-account script ↔ /auth/register contract", () => {
  it("the API still requires a literal consent:true for registration", () => {
    // Anchors the assumption this guard exists for. If consent stops being
    // required, this test is the place that learns about it.
    expect(authRoutes).toMatch(/consent:\s*z\.literal\(true\)/);
  });

  it("the script sends consent:true in its register body", () => {
    const registerCall = scriptSource.slice(scriptSource.indexOf('"/auth/register"'));
    const body = registerCall.slice(0, registerCall.indexOf("});"));
    expect(body).toMatch(/consent:\s*true/);
  });

  it("the script treats a taken phone as success (needsLogin), not as a 409 conflict", () => {
    // Registration is enumeration-safe: an existing phone returns 200 with
    // `needsLogin:true` and creates nothing. A script that expected 409 would
    // fall through to the "password does not match" abort on an idempotent re-run.
    expect(scriptSource).toMatch(/needsLogin/);
  });

  it("the script never ships the public demo password as a default", () => {
    // The seeded Demo@1234 identities are exactly what the production guard in
    // prisma/seed.ts exists to keep off a live database (CERT-01). A provisioning
    // script must not reintroduce them by default.
    expect(scriptSource).not.toMatch(/Demo@1234/);
  });
});
