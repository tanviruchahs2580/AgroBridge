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
 *
 * `weather` and `notifications` were added for the same reason, and the audit that
 * added them found the trap already sprung a second time: Home read weather under
 * `"home-weather"` while My Farm invalidated `"weather"`, and Home read
 * notifications under `"home-notifications"` while the notifications screen
 * invalidated `"notifications"`. Neither cross-screen refresh could fire.
 *
 * The rule is not "every endpoint gets a key" — only endpoints with more than one
 * consumer need one, because only those can be invalidated from another screen.
 */
export const RESOURCE_KEYS = {
  /** `GET /farms` — read by Home, My Farm, the booking dialog and the sell form. */
  farms: "farms",
  /** `GET /weather` — read by Home and My Farm; invalidated by farm mutations. */
  weather: "weather",
  /** `GET /notifications` — read by Home (unread badge) and the notifications screen. */
  notifications: "notifications",
} as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[keyof typeof RESOURCE_KEYS];
