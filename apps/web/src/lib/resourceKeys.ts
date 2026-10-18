/**
 * Resource keys for the data layer, in one place.
 *
 * `invalidate(key)` matches a key **exactly** — there are no key families, no
 * prefixes, no globs (see useResource.ts). Two names for one endpoint therefore
 * mean that a mutation through one name leaves any other consumer of that same
 * endpoint holding stale data, with nothing to warn anyone.
 *
 * That had already happened here: `GET /farms` was fetched as `"farms"`,
 * `"services-farms"` and `"sell-crop-farms"` in three different screens, so
 * `invalidate("farms")` reached a third of the consumers. Nothing looked broken
 * only because every screen remounts and refetches on navigation — a keep-alive, a
 * background refresh, or a second mounted consumer would have turned that luck into
 * a user-visible bug. The shared key removes the trap; `resourceKeys.test.ts` fails
 * the build if a feature starts fetching a shared endpoint under a private name
 * again.
 */
export const RESOURCE_KEYS = {
  /** `GET /farms` — read by Home, My Farm, the booking dialog and the sell form. */
  farms: "farms",
} as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[keyof typeof RESOURCE_KEYS];
