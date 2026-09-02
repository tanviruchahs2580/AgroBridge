import { hasPermission, PERMISSIONS } from "../../middleware/rbac.js";
import { forbidden } from "../../lib/errors.js";

/**
 * Centralized authorization policy.
 * Replaces scattered `["ADMIN","SUPER_ADMIN"].includes(role)` checks with
 * `can(user, "payment:approve")` style calls.
 *
 * Two layers:
 *  1. POLICY_MAP — maps high-level resource:action strings to the underlying
 *     RBAC permission key (from PERMISSIONS table).
 *  2. PRIVILEGED_ACTIONS — explicit allow-list for actions that historically
 *     used hard-coded role includes (e.g., payment:read:any).
 */

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type PolicyAction =
  | "payment:approve"
  | "payment:refund"
  | "payment:payout"
  | "payment:read:any"
  | "payment:read:own"
  | "withdrawal:approve"
  | "withdrawal:read:any"
  | "order:read:any"
  | "procurement:pay"
  | "finance:withdrawals"
  | (string & {});

const POLICY_MAP: Record<string, string> = {
  "payment:approve": "payments:refund",
  "payment:refund": "payments:refund",
  "payment:payout": "procurement:pay",
  "procurement:pay": "procurement:pay",
  "payment:read:any": "orders:read:any",
  "order:read:any": "orders:read:any",
  "withdrawal:approve": "finance:withdrawals",
  "withdrawal:read:any": "finance:withdrawals",
  "finance:withdrawals": "finance:withdrawals",
};

// Actions whose legacy definition was a fixed role set rather than a
// PERMISSIONS key. Keeping them explicit preserves pre-refactor behaviour
// while still routing through `can()` (so future role changes happen here).
const PRIVILEGED_ACTIONS: Record<string, string[]> = {
  "payment:approve": ["SUPER_ADMIN", "ADMIN"],
  "payment:refund": ["SUPER_ADMIN", "ADMIN"],
  "payment:read:any": ["SUPER_ADMIN", "ADMIN"],
  "withdrawal:read:any": ["SUPER_ADMIN", "ADMIN"],
  "order:read:any": ["SUPER_ADMIN", "ADMIN", "REGIONAL_MANAGER"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRole(principal: unknown): string | null {
  if (!principal) return null;
  if (typeof principal === "string") return principal;
  if (typeof principal === "object" && principal !== null && "role" in principal) {
    const r = (principal as { role?: unknown }).role;
    return typeof r === "string" ? r : null;
  }
  return null;
}

function isPrivilegedRole(role: string): boolean {
  // SUPER_ADMIN always has "*" so is privileged for everything; treat it
  // explicitly so callers that check can("payment:read:any") behave correctly
  // even if PERMISSIONS were ever misconfigured.
  if (role === "SUPER_ADMIN") return true;
  const perms = PERMISSIONS[role];
  return !!perms?.includes("*");
}

// ---------------------------------------------------------------------------
// Public API — can() / assertCan() / isPrivileged()
// ---------------------------------------------------------------------------

/**
 * Primary policy check.
 * @example can({ role: "ADMIN" }, "payment:refund") // true
 * @example can("FARMER", "payment:approve") // false
 */
export function can(principal: { role: string } | string | null | undefined, action: string): boolean {
  const role = getRole(principal);
  if (!role) return false;

  // Super-admin wildcard — fast path
  if (isPrivilegedRole(role)) return true;

  // 1) Explicit allow-list for this action (legacy includes replacement)
  const allowed = PRIVILEGED_ACTIONS[action];
  if (allowed && allowed.includes(role)) return true;

  // 2) Map high-level action -> underlying RBAC permission and check it
  const permission = POLICY_MAP[action] ?? action;
  if (hasPermission(role, permission)) return true;

  // 3) Fallback: treat the action itself as a permission key (lets callers
  //    pass raw permission strings like "payments:refund" through `can`).
  if (permission !== action && hasPermission(role, action)) return true;

  return false;
}

/**
 * Throw-friendly wrapper for middleware / service guards.
 * Throws FORBIDDEN AppError when `can` returns false.
 */
export function assertCan(
  principal: { role: string } | string | null | undefined,
  action: string,
  message?: string,
): void {
  if (!can(principal, action)) {
    throw forbidden(message ?? `Missing required permission: ${action}`);
  }
}

/**
 * Replaces scattered `["ADMIN","SUPER_ADMIN"].includes(role)` predicates.
 * Prefer `can(user, "payment:read:any")` in new code; this helper is kept
 * for incremental migration and for call sites that truly mean
 * "is this user an admin-family principal?"
 */
export function isPrivileged(principal: { role: string } | string | null | undefined): boolean {
  const role = getRole(principal);
  if (!role) return false;
  if (isPrivilegedRole(role)) return true;
  return ["ADMIN", "SUPER_ADMIN"].includes(role);
}

// Convenience aliases that mirror the policy spec wording
export const policy = {
  can,
  assertCan,
  isPrivileged,
  hasPermission,
  PERMISSIONS,
};

export default policy;
