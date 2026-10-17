import { prisma } from "./prisma.js";
import { forbidden } from "../shared/errors/index.js";

/**
 * Roles whose authority is limited to farmers in their own `user.region`.
 * ADMIN / SUPER_ADMIN are unrestricted; a territory role with no region set
 * sees everything (matching the list endpoints' documented behaviour).
 */
const TERRITORY_SCOPED_ROLES = ["REGIONAL_MANAGER", "AREA_MANAGER", "PROCUREMENT_MANAGER", "COLLECTION_MANAGER"];

/** The region an actor is limited to, or null when unrestricted. */
export async function actorRegionLimit(userId: string, role: string): Promise<string | null> {
  if (!TERRITORY_SCOPED_ROLES.includes(role)) return null;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { region: true } });
  return me?.region ?? null;
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
