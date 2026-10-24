import type { NextFunction, Request, Response } from "express";
import { forbidden } from "../shared/errors/index.js";

/**
 * Server-side RBAC. Roles are never trusted from the client. The role is
 * re-read from the DATABASE on every authenticated request
 * (middleware/auth.ts requireAuth), so a demotion or suspension takes effect
 * on the next request — a stale role inside a still-valid access token is
 * never the authority. Permission sets below are pure functions of that role.
 */
export const PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  ADMIN: [
    "users:read", "users:manage",
    "products:manage",
    "orders:read:any", "orders:manage",
    "bookings:assign", "bookings:manage:any",
    "procurement:review", "procurement:pay",
    "payments:refund",
    "finance:withdrawals",
    "membership:manage",
    "admin:metrics",
    "audit:read",
    "disease:review",
    "providers:manage",
    "services:manage",
  ],
  REGIONAL_MANAGER: ["orders:read:any", "bookings:assign", "procurement:review", "admin:metrics"],
  AREA_MANAGER: ["bookings:assign", "procurement:review"],
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
