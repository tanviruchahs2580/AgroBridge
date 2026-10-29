import type { LegalDoc } from "./content";

/**
 * The single source for the legal documents' routes.
 *
 * `App.tsx` renders one `<Route>` per entry and `Legal.tsx` builds the document
 * switcher's links from the same array, so a document can no longer link to a
 * path that was never mounted. (The chip for the deletion document used to lead
 * to `/deletion` — the route is `/account-deletion` — and landed on NotFound.)
 *
 * Kept out of `content.ts` on purpose: that module carries the full legal copy
 * (both languages) and is lazily loaded, while the router needs only these three
 * paths on the critical path.
 */
export const LEGAL_ROUTES: ReadonlyArray<{ id: LegalDoc["id"]; path: string }> = [
  { id: "privacy", path: "/privacy" },
  { id: "terms", path: "/terms" },
  { id: "deletion", path: "/account-deletion" },
];
