import type { NextFunction, Request, Response } from "express";
import { forbidden } from "../shared/errors/index.js";

/**
 * Server-side RBAC. Roles are never trusted from the client. The role is
 * re-read from the DATABASE on every authenticated request
 * (middleware/auth.ts requireAuth), so a demotion or suspension takes effect
 * on the next request — a stale role inside a still-valid access token is
 * never the authority. Permission sets below are pure functions of that role.
 *
 * Every permission here is either enforced by at least one route's
 * `requirePermission(...)` or named in `INTENTIONALLY_UNUSED` below with the
 * reason it is held but not yet reachable (F-08).
 * `tests/permission-reachability.test.ts` fails when a permission appears in
 * neither place, so the inventory can no longer under-report the model, and
 * `contracts/roles.json` + `docs/route-role-matrix.md` are rendered from this
 * table.
 */
export const PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  ADMIN: [
    "users:read", "users:manage",
    "products:manage",
    "orders:read:any", "orders:manage",
    "bookings:read:any", "bookings:assign", "bookings:manage:any",
    "procurement:review", "procurement:pay",
    "procurement:read:any",
    "payments:read:any",
    "payments:refund",
    "finance:withdrawals",
    "membership:manage",
    "admin:metrics",
    "audit:read",
    "disease:review",
    "providers:manage",
    "services:manage",
    // Organisation capabilities the operator tier has always exercised through
    // the organisations module (it was the "privileged" branch of every inline
    // check there). Declared here so the named permission is the mechanism the
    // route gate reads, instead of a role list the gate could contradict —
    // without these three the ADMIN tier would LOSE org reads and creation,
    // which is the regression tests/permission-migration-equivalence pins (F-08).
    "org:read", "org:manage", "farm:read:org",
  ],
  // `orders:read:any` is territory-scoped at the route: a REGIONAL_MANAGER sees
  // the orders of its own region, not the fleet's (marketplace/routes.ts).
  // `bookings:read:any` is what lets the role SEE the assignment queue it works
  // (F-63a); it was previously held-but-denied because the list route carried an
  // inline ADMIN/SUPER_ADMIN check the permission table disagreed with.
  // `payments:read:any` on the ADMIN tier is the "every payment" half of the
  // GET /payments read scope; it is applied in the handler because the same
  // route serves the buyer's own list (payments/routes.ts).
  // `procurement:read:any` is the identical pattern for the procurement list:
  // one route serves the buyer's own offers and the admin/finance all-rows view,
  // so the permission decides the scope in the handler rather than gating the
  // route (procurement/routes.ts).
  REGIONAL_MANAGER: ["orders:read:any", "bookings:read:any", "bookings:assign", "procurement:review", "admin:metrics"],
  AREA_MANAGER: ["bookings:read:any", "bookings:assign", "procurement:review"],
  PROCUREMENT_MANAGER: ["procurement:review", "procurement:pay"],
  WAREHOUSE_MANAGER: ["inventory:manage"],
  COLLECTION_MANAGER: ["procurement:review"],
  FIELD_AGENT: ["farmers:assist"],
  SERVICE_PROVIDER: ["bookings:execute", "bookings:manage:own"],
  DEALER: ["products:manage", "orders:read:own"],
  CORPORATE: ["org:read", "org:manage", "farm:read:org", "procurement:read:org"],
  COOPERATIVE: ["org:read", "org:manage", "farm:read:org"],
  FARMER: [],
};

/**
 * Permissions that no route requires today, with the reason and the owner
 * decision that keeps them. A permission absent from both the code and this
 * table fails the reachability guard (F-08), so "no route gates on it yet" is
 * a recorded decision rather than an accident.
 *
 * Note the distinction the guard draws: a permission *used* in a handler
 * (`hasPermission(role, "orders:read:any")` scoping a query) counts as
 * reachable — it decides what the caller sees. A permission that only appears
 * in this table is a declared capability with no implementation.
 */
export const INTENTIONALLY_UNUSED: Record<string, string> = {
  "inventory:manage":
    "WAREHOUSE_MANAGER's warehouse surface (stock ledger, GRN, bin locations) is not built yet — there is no route to gate and no handler that reads it. Deleting it would leave the role with no declared capability at all; the roadmap keeps the role (F-08, OD-06).",
  "farmers:assist":
    "FIELD_AGENT's assisted-registration and field-visit surface is not built yet. Kept for the same reason as inventory:manage — the role exists in the contract and keeps a declared capability (F-08, OD-06).",
  "bookings:execute":
    "SERVICE_PROVIDER execution is enforced by the same handler-scope predicate (a provider may only transition bookings assigned to it, services/routes.ts) plus the booking state machine; no route can declare it because the status route serves both the provider's execution and the buyer's own cancellation, and a route-level gate would refuse the buyer (F-08).",
  "membership:manage":
    "Membership administration routes are not built; the public plans catalogue and self-service purchase are the only membership surface. Kept for the operator console (F-08, OD-06).",
  "procurement:read:org":
    "CORPORATE holds it but the procurement module exposes no org-scoped read yet; kept for the corporate bulk-buy view (F-08, OD-06).",
  "orders:read:own":
    "The 'own rows' half of the orders:read:any/own pair. Routing every buyer's order list through requirePermission(\"orders:read:own\") would be a no-op gate — every authenticated role may read its own rows — so the routes scope with `{ userId }` and use orders:read:any to decide whether to widen (marketplace/routes.ts). Kept because it is the declarative statement of that scope (F-08).",
  "orders:manage":
    "ADMIN's order-administration capability (cancel/refund/reassign on someone else's order) has no route yet: buyers cancel their own orders, and the money paths are refunds (payments:refund) and checkout. Kept for the operator order console (F-08, OD-06).",
};

export function hasPermission(role: string, permission: string): boolean {
  const perms = PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes("*") || perms.includes(permission);
}

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(forbidden());
    if (!hasPermission(req.auth.role, permission)) return next(forbidden());
    next();
  };
}
