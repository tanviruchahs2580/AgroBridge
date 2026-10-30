import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWLEDGE_BASE } from "../src/providers/ai/knowledge.js";

/**
 * A2-02 — the published coverage map must not drift from the corpus.
 *
 * `docs/kb-coverage.md` is the auditable answer to "what does the AI actually
 * know, and what does it not". This test parses its table and requires an
 * exact match with `KNOWLEDGE_BASE` (id, crop, titles, provenance status, row
 * count), so adding, removing or re-titling an entry without updating the
 * coverage document fails CI.
 */
const DOC = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../docs/kb-coverage.md");

describe("knowledge-base coverage map matches the corpus (A2-02)", () => {
  const md = readFileSync(DOC, "utf8");
  const rows = md
    .split("\n")
    .filter((l) => /^\|\s*`/.test(l))
    .map((l) => l.split("|").map((c) => c.trim()));

  it("has exactly one row per corpus entry, with no extra rows", () => {
    expect(rows.length).toBe(KNOWLEDGE_BASE.length);
  });

  it("every entry's id, crop, titles and status are recorded exactly", () => {
    for (const e of KNOWLEDGE_BASE) {
      const row = rows.find((r) => r[1] === `\`${e.id}\``);
      expect(row, `${e.id} is missing from docs/kb-coverage.md`).toBeTruthy();
      expect(row![2]!.startsWith(e.crop), `${e.id} crop mismatch`).toBe(true);
      expect(row![4], `${e.id} titleEn mismatch`).toBe(e.titleEn);
      expect(row![5], `${e.id} titleBn mismatch`).toBe(e.titleBn);
      expect(row![6], `${e.id} status mismatch`).toBe(e.status);
      expect(row![7], `${e.id} sign-off column must be honest`).toBe("none");
    }
  });

  it("states the coverage limits it cannot back with data (no national-coverage claim)", () => {
    expect(md).toMatch(/No national coverage claim/i);
    for (const gap of ["vegetables", "pulses", "livestock", "fisheries"]) {
      expect(md.toLowerCase(), `missing gap: ${gap}`).toContain(gap);
    }
    expect(md).toContain("UNSOURCED");
  });
});
