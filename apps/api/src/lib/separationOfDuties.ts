import { forbidden } from "../shared/errors/index.js";
import { actorRegionLimit, assertSubjectInRegion } from "./territory.js";

/**
 * Separation of duties for money-moving review steps.
 *
 * Procurement is the one flow where a single actor could otherwise be both
 * sides of the same transaction: offers carry a self-declared grade and
 * moisture percentage that fix `netPayablePaisa` at creation, the QC step only
 * passes or rejects (it never re-measures), and `PROCUREMENT_MANAGER` holds
 * both `procurement:review` and `procurement:pay`. Without this guard one
 * account could submit an offer as a farmer and carry it to payout into its own
 * wallet.
 *
 * `SUPER_ADMIN` is the deliberate exception: it is the platform's break-glass
 * role (the only wildcard in `middleware/rbac.ts`), so a single-operator
 * deployment can still settle a genuine offer. Every other role — ADMIN
 * included — must not act on its own submission.
 */
const BREAK_GLASS_ROLE = "SUPER_ADMIN";

export function assertNotSelfDealing(actorId: string, subjectId: string, actorRole: string, what: string): void {
  if (actorId !== subjectId) return;
  if (actorRole === BREAK_GLASS_ROLE) return;
  throw forbidden(`${what} was submitted by your own account — a different reviewer must handle it (separation of duties)`);
}

/**
 * The complete "may this actor act on this procurement offer?" predicate:
 * region scoping first (a territory manager is confined to its own region),
 * then separation of duties. Kept as one function because the two guards only
 * mean something together — the region check passes trivially for your own
 * offer (your region is your region), so on its own it never prevents
 * self-dealing. Every procurement mutation that moves money uses this.
 */
export async function assertMayActOnProcurementOffer(
  actor: { userId: string; role: string },
  subjectUserId: string,
  what = "This procurement order"
): Promise<void> {
  await assertSubjectInRegion(await actorRegionLimit(actor.userId, actor.role), subjectUserId, what);
  assertNotSelfDealing(actor.userId, subjectUserId, actor.role, what);
}
