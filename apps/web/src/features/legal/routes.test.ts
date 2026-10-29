import { describe, expect, it } from "vitest";
import { LEGAL_ROUTES } from "./routes";
import { LEGAL_DOCS } from "./content";

/**
 * The legal documents are reachable through a single route table; these tests
 * pin the two ways it can silently drift into a dead link.
 */
describe("legal routes", () => {
  it("every document has a route, and every route a document", () => {
    const docIds = Object.keys(LEGAL_DOCS).sort();
    const routeIds = LEGAL_ROUTES.map((r) => r.id).sort();
    expect(routeIds).toEqual(docIds);
  });

  it("paths are absolute, unique and non-empty", () => {
    const paths = LEGAL_ROUTES.map((r) => r.path);
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(true);
      expect(p.length).toBeGreaterThan(1);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });
});
