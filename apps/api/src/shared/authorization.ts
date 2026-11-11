/**
 * The platform-admin tier, named once.
 *
 * `ADMIN` and `SUPER_ADMIN` are the only roles that bypass the row-level
 * ownership predicates (farms, plots, crop cycles) — the same two roles that
 * every `requirePermission` route on the admin tier resolves to. The check
 * existed as an inline role-list `includes(role)` comparison in several
 * modules, which the route-role matrix cannot see and which could drift from
 * the permission table (F-08). Kept HERE, one line, because the two roles are a
 * policy statement rather than a route gate: routes gate through
 * `requirePermission`, and this helper answers only "is this caller the
 * platform tier" for handler-level decisions.
 *
 * `tests/permission-reachability.test.ts` scans the modules for inline role
 * lists and requires this line to carry the `authorization-exempt` marker: this
 * is the one sanctioned home for this particular list.
 */
export const PLATFORM_ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"] as const; // authorization-exempt: the sanctioned home for this role list; routes gate through requirePermission.

export function isPlatformAdmin(role: string): boolean {
  return (PLATFORM_ADMIN_ROLES as readonly string[]).includes(role);
}
