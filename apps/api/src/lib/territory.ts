import { prisma } from "./prisma.js";
import { forbidden } from "../shared/errors/index.js";
import { logger } from "./logger.js";

/**
 * Roles whose authority is limited to farmers in their own `user.region`.
 * ADMIN / SUPER_ADMIN are unrestricted.
 *
 * A territory role with **no region assigned** is currently unrestricted, which
 * contradicts how BR-23 reads ("a territory manager may only act on offers whose
 * owner is in their region"). It is a configuration omission rather than an
 * attack — an operator assigns the role and leaves the region blank, and that
 * manager then sees every region's queue, including each farmer's name and phone
 * number. Tightening the default is a permission-boundary decision, so instead of
 * changing it silently the case is logged, pinned by
 * `tests/territory-unassigned.test.ts`, and recorded as ODL-007. The log line is
 * the operator's signal that a manager is acting without a territory.
 */
const TERRITORY_SCOPED_ROLES = ["REGIONAL_MANAGER", "AREA_MANAGER", "PROCUREMENT_MANAGER", "COLLECTION_MANAGER"];

/** Whether this role's authority is limited to its own region. The list lives here
 *  only — a caller that re-listed these roles could disagree with the guards. */
export const isTerritoryScopedRole = (role: string): boolean => TERRITORY_SCOPED_ROLES.includes(role);

/** The region an actor is limited to, or null when unrestricted. */
export async function actorRegionLimit(userId: string, role: string): Promise<string | null> {
  if (!TERRITORY_SCOPED_ROLES.includes(role)) return null;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { region: true } });
  const region = me?.region ?? null;
  if (!region) {
    logger.warn(
      { userId, role, event: "territory.unassigned" },
      "a territory-scoped role is acting with no region assigned, so its view is unrestricted (ODL-007) — assign a region or decide the intended boundary"
    );
  }
  return region;
}

/**
 * Enforces the same territory predicate the list endpoints apply, for
 * mutations that address a record by id. Without it a regional manager could
 * review, assign or pay out a record from another region simply by knowing its
 * id — the queue hid it, but the endpoint accepted it.
 */
export async function assertSubjectInRegion(
  regionLimit: string | null,
  subjectUserId: string,
  what = "This record"
): Promise<void> {
  if (!regionLimit) return;
  const subject = await prisma.user.findUnique({ where: { id: subjectUserId }, select: { region: true } });
  if (!subject || subject.region !== regionLimit) throw forbidden(`${what} belongs to another region`);
}
