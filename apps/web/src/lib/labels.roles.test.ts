import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roleLabel } from "./labels";

/**
 * Role-vocabulary guard, web side.
 *
 * The server can assign thirteen roles; the UI labelled five of them, so an operator
 * table or an audit row showing one of the other nine printed the raw enum
 * ("REGIONAL_MANAGER") in the middle of Bengali copy. `contracts/roles.json` is the
 * declared vocabulary, and this test fails the moment a role the server can issue has
 * no user-facing label — which is how it drifted the first time.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  readFileSync(path.resolve(here, "..", "..", "..", "..", "contracts", "roles.json"), "utf8")
) as { roles: string[]; legacy_labels?: Record<string, string> };

const BENGALI = /[\u0980-\u09FF]/;

describe("role labels", () => {
  it("every role the server can assign has a label", () => {
    const unlabelled = contract.roles.filter((r) => roleLabel(r, "en") === r);
    expect(unlabelled, `roles rendering as raw enum strings: ${unlabelled.join(", ")}`).toEqual([]);
  });

  it("labels are real words in both languages, not the enum repeated", () => {
    for (const role of contract.roles) {
      const en = roleLabel(role, "en");
      const bn = roleLabel(role, "bn");
      expect(en.length, `${role} has an empty English label`).toBeGreaterThan(1);
      expect(bn.length, `${role} has an empty Bengali label`).toBeGreaterThan(1);
      expect(en, `${role}: the English label is the enum itself`).not.toBe(role);
      expect(bn, `${role}: the Bengali label is the enum itself`).not.toBe(role);
    }
  });

  it("the Bengali label is actually Bengali, not a copy of the English one", () => {
    // LibreOffice-free check: a Bengali label must contain Bengali script. Product
    // names that stay Latin in Bengali copy (AgroBridge, QC) are fine as long as the
    // label carries Bengali somewhere; a pure-Latin Bengali label usually means the
    // translation was forgotten.
    const untranslated = contract.roles.filter((r) => {
      const bn = roleLabel(r, "bn");
      const en = roleLabel(r, "en");
      return bn === en || !BENGALI.test(bn);
    });
    expect(untranslated, `Bengali labels missing or copied from English: ${untranslated.join(", ")}`).toEqual([]);
  });

  it("labels for the legacy-only role still resolve (a historical row must not print an enum)", () => {
    for (const role of Object.keys(contract.legacy_labels ?? {})) {
      expect(roleLabel(role, "en")).not.toBe(role);
      expect(roleLabel(role, "bn")).not.toBe(role);
    }
  });

  it("labels exactly the contract's vocabulary — no missing role, no undocumented extra", () => {
    // The other direction of the guard. The tests above prove every contract role
    // HAS a label; none of them would notice the web map growing a label for a
    // role the contract does not know — the "fourth home" drift `contracts/
    // roles.json` itself warns about. Set-equality is asserted against the map's
    // own keys, read from the source, because the map is deliberately private and
    // its only other observable is a function. (Same source-scanning approach as
    // lib/i18n.deadkeys.test.ts, for the same reason: no new export is worth
    // adding just to be watched.)
    //
    // QC_OFFICER is expected here: contracts/roles.json::legacy_labels keeps it on
    // purpose, so a historical row carrying it renders as words instead of
    // "QC_OFFICER". The tolerated set is data-driven — adding a legacy entry there
    // is what lets a new extra key pass, and that edit carries the required reason.
    const source = readFileSync(path.join(here, "labels.ts"), "utf8");
    const block = source.match(/const ROLE_KEYS: Record<string, DictKey> = \{([\s\S]*?)\n\};/);
    expect(block, "the ROLE_KEYS block moved or was renamed — update this guard").toBeTruthy();
    const declared = [...block![1]!.matchAll(/([A-Z][A-Z0-9_]*)\s*:/g)].map((m) => m[1]!);

    const expected = new Set([...contract.roles, ...Object.keys(contract.legacy_labels ?? {})]);
    const missing = [...expected].filter((r) => !declared.includes(r));
    const extra = declared.filter((r) => !expected.has(r));
    expect(missing, `contract roles with no web label: ${missing.join(", ")}`).toEqual([]);
    expect(
      extra,
      `web-only role labels with no contract entry: ${extra.join(", ")} — delete them, or add them to ` +
        `contracts/roles.json::legacy_labels with the reason a row can still carry them`
    ).toEqual([]);
    // Guard the guard: the scan must have found a real vocabulary.
    expect(declared.length).toBe(contract.roles.length + Object.keys(contract.legacy_labels ?? {}).length);
  });

  it("an unknown role falls back to the raw string rather than to a wrong label", () => {
    expect(roleLabel("NOT_A_ROLE", "en")).toBe("NOT_A_ROLE");
    expect(roleLabel("", "bn")).toBe("");
  });
});
