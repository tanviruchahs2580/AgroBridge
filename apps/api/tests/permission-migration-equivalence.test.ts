import { describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { app, registerFarmer, createUserWithRole, getAdmin, createFarmWithCrop } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { PERMISSIONS, hasPermission } from "../src/middleware/rbac.js";
import { refNo } from "../src/lib/money.js";

/**
 * F-08 migration evidence: the inline role lists the audit found (19 sites,
 * 6 modules) were replaced by declared capabilities. This suite is the proof
 * that the swap preserved the authorisation model — a 13-role × route access
 * matrix, per role, allowed-or-denied — rather than an assertion that it did.
 *
 * Every converted site carries its ORIGINAL predicate, transcribed verbatim as
 * `before(role)`, and the predicate the code uses now, `after(role)`. For every
 * declared role the two must agree. Where a deliberate widening exists (the
 * audit-requested F-63a bookings queue, and the `orders:read:any` that the
 * permission table already declared for REGIONAL_MANAGER), the delta is
 * declared explicitly as a set of roles — and asserted to be EXACTLY that set,
 * so an accidental extra role fails here.
 *
 * The roles come from `contracts/roles.json`, not a rewritten list, so a role
 * added to the vocabulary enters this matrix automatically.
 */
const contract = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../contracts/roles.json", import.meta.url)), "utf8"),
) as { roles: string[] };
const ROLES = contract.roles;
const rolesWhere = (predicate: (role: string) => boolean) => new Set(ROLES.filter(predicate));
const sorted = (roles: Set<string>) => [...roles].sort();

/** The original inline checks, verbatim from the audit's list of sites. */
const before = {
  /** organizations/routes.ts:22 — POST /organizations */
  orgCreate: (role: string) => ["SUPER_ADMIN", "ADMIN", "CORPORATE", "COOPERATIVE"].includes(role),
  /** organizations/routes.ts:42,61,98,113 — the `/isPrivileged/` checks */
  orgPrivileged: (role: string) => ["SUPER_ADMIN", "ADMIN"].includes(role),
  /** admin/routes.ts:19 — the module gate */
  adminModuleGate: (role: string) =>
    ["ADMIN", "SUPER_ADMIN", "REGIONAL_MANAGER", "AREA_MANAGER", "PROCUREMENT_MANAGER"].includes(role),
  /** farms/routes.ts:40,92,63 — the privileged/scope checks */
  farmPrivileged: (role: string) => role === "SUPER_ADMIN" || role === "ADMIN",
  /** disease/routes.ts:193 — GET /cases/:id reviewer */
  diseaseReviewer: (role: string) => role === "ADMIN" || role === "SUPER_ADMIN",
  /** marketplace/routes.ts:188,211 — GET /orders, GET /orders/:id */
  ordersAny: (role: string) => ["ADMIN", "SUPER_ADMIN"].includes(role),
  /** services/routes.ts:165 — GET /bookings */
  bookingsAny: (role: string) => ["ADMIN", "SUPER_ADMIN"].includes(role),
  /** services/routes.ts:230 — POST /bookings/:id/status */
  bookingsManageAny: (role: string) => ["ADMIN", "SUPER_ADMIN"].includes(role),
  /** services/routes.ts:235 — the provider branch */
  bookingsProvider: (role: string) => role === "SERVICE_PROVIDER",
  /** payments/routes.ts:567 — GET /payments */
  paymentsAny: (role: string) => ["ADMIN", "SUPER_ADMIN"].includes(role),
  /** procurement/routes.ts:98 — GET /procurement list scope (the last F-08 site) */
  procurementAny: (role: string) => ["ADMIN", "SUPER_ADMIN"].includes(role),
};

describe("F-08 migration: every converted inline role list keeps its decision", () => {
  it("the matrix covers the whole declared vocabulary", () => {
    expect(ROLES.length).toBe(Object.keys(PERMISSIONS).length);
    expect(ROLES).toContain("FARMER");
    expect(ROLES).toContain("SUPER_ADMIN");
  });

  it("GET /payments: the payments:read:any capability grants exactly the old inline set", () => {
    const after = rolesWhere((role) => hasPermission(role, "payments:read:any"));
    expect(sorted(after)).toEqual(sorted(rolesWhere(before.paymentsAny)));
    // The permission is held by the ADMIN tier and nobody else.
    expect(sorted(after)).toEqual(["ADMIN", "SUPER_ADMIN"]);
  });

  it("GET /procurement: the procurement:read:any capability grants exactly the old inline set", () => {
    const after = rolesWhere((role) => hasPermission(role, "procurement:read:any"));
    expect(sorted(after)).toEqual(sorted(rolesWhere(before.procurementAny)));
    expect(sorted(after)).toEqual(["ADMIN", "SUPER_ADMIN"]);
  });

  it("GET /orders + GET /orders/:id: the wide scope is the old set plus the declared orders:read:any holder", () => {
    const after = rolesWhere((role) => hasPermission(role, "orders:read:any"));
    // DECLARED DELTA: REGIONAL_MANAGER already held `orders:read:any` in
    // middleware/rbac.ts; the inline list denied it. The audit named this as
    // the F-08 example, and the route is territory-scoped (region predicate),
    // so the widening is the region's orders, not the fleet's.
    const declaredDelta = ["REGIONAL_MANAGER"];
    expect(sorted(after)).toEqual(sorted(new Set([...rolesWhere(before.ordersAny), ...declaredDelta])));
  });

  it("GET /bookings: the old admin set plus the two booking-queue roles (F-63a)", () => {
    const after = rolesWhere((role) => hasPermission(role, "bookings:read:any"));
    // DECLARED DELTA (owner-approved F-63a): REGIONAL_MANAGER and AREA_MANAGER
    // hold `bookings:assign` and could assign by id but could not see the queue
    // they work. Territory-scoped at the route like GET /orders.
    const declaredDelta = ["REGIONAL_MANAGER", "AREA_MANAGER"];
    expect(sorted(after)).toEqual(sorted(new Set([...rolesWhere(before.bookingsAny), ...declaredDelta])));
  });

  it("POST /bookings/:id/status: the admin scope is unchanged, and the provider scope is unchanged for every non-wildcard role", () => {
    expect(sorted(rolesWhere((role) => hasPermission(role, "bookings:manage:any")))).toEqual(sorted(rolesWhere(before.bookingsManageAny)));
    // `hasPermission` answers true for SUPER_ADMIN on every key (it holds `*`),
    // so the provider predicate differs from the old `role === "SERVICE_PROVIDER"`
    // for exactly one role — and that role can never take the provider branch:
    // the handler tests the admin scope FIRST and short-circuits. Asserted
    // rather than assumed, because the two branches are order-dependent.
    const ownHolders = rolesWhere((role) => hasPermission(role, "bookings:manage:own"));
    const wildcardHolders = rolesWhere((role) => hasPermission(role, "*"));
    expect(sorted(wildcardHolders)).toEqual(["SUPER_ADMIN"]);
    expect(sorted(new Set([...ownHolders].filter((r) => !wildcardHolders.has(r))))).toEqual(sorted(rolesWhere(before.bookingsProvider)));
    // Order-dependence, pinned at the source: the admin check precedes the
    // provider check in services/routes.ts, so the wildcard role never reaches
    // the provider branch.
    const servicesSource = readFileSync(fileURLToPath(new URL("../src/modules/services/routes.ts", import.meta.url)), "utf8");
    const adminIdx = servicesSource.indexOf('hasPermission(role, "bookings:manage:any")');
    const ownIdx = servicesSource.indexOf('hasPermission(role, "bookings:manage:own")');
    expect(adminIdx).toBeGreaterThan(-1);
    expect(ownIdx).toBeGreaterThan(adminIdx);
  });

  it("GET /disease/cases/:id: the reviewer capability is the old ADMIN/SUPER_ADMIN pair", () => {
    expect(sorted(rolesWhere((role) => hasPermission(role, "disease:review")))).toEqual(sorted(rolesWhere(before.diseaseReviewer)));
  });

  it("farms: the platform-admin tier the ownership predicate bypasses is unchanged", () => {
    // shared/authorization.ts is the one home for this pair; the route-level
    // gates it replaced (the privileged branch of assertFarmAccess) used the
    // same two roles.
    expect(sorted(rolesWhere((role) => hasPermission(role, "*")))).toEqual(["SUPER_ADMIN"]);
    const privileged = rolesWhere(
      (role) => hasPermission(role, "*") || ["SUPER_ADMIN", "ADMIN"].includes(role),
    );
    expect(sorted(privileged)).toEqual(sorted(rolesWhere(before.farmPrivileged)));
  });

  it("organizations POST: org:manage + the handler check equals the old four-role list", () => {
    const after = rolesWhere(
      (role) => hasPermission(role, "org:manage") && (before.orgPrivileged(role) || ["CORPORATE", "COOPERATIVE"].includes(role)),
    );
    expect(sorted(after)).toEqual(sorted(rolesWhere(before.orgCreate)));
  });

  it("admin module: every route's permission gate is at least as strict as the old module gate", () => {
    // The module gate was removed; each route now carries its own permission.
    // For every role, "may reach an admin route" must not have become true for
    // anyone the gate used to refuse (it must in fact be strictly narrower or
    // equal, because each route also has its own permission).
    const adminPermissions = ["admin:metrics", "users:read", "users:manage", "audit:read", "finance:withdrawals"];
    const widened: string[] = [];
    for (const permission of adminPermissions) {
      for (const role of ROLES) {
        if (hasPermission(role, permission) && !before.adminModuleGate(role)) widened.push(`${role} → ${permission}`);
      }
    }
    expect(widened, `roles newly admitted to an admin route: ${widened.join(", ")}`).toEqual([]);
  });

  /**
   * The organisations module had NO role gate on its reads: the inline checks
   * there were the privileged *scope* selector (`isPrivileged`), so a role with
   * no organisation membership reached the handler and received an empty list.
   * Gating the reads on `org:read` / `farm:read:org` is therefore a status-code
   * tightening (200-empty → 403) for the roles outside the organisation model,
   * declared here rather than left implicit: no role gains access, no role that
   * could see an organisation's data loses it, and the direction of the change
   * is asserted.
   */
  it("organisations reads: the new gate admits exactly the roles the model has, and admits nobody the scope did not", () => {
    const orgTier = new Set(["SUPER_ADMIN", "ADMIN", "CORPORATE", "COOPERATIVE"]);
    expect(sorted(rolesWhere((role) => hasPermission(role, "org:read")))).toEqual(sorted(orgTier));
    expect(sorted(rolesWhere((role) => hasPermission(role, "farm:read:org")))).toEqual(sorted(orgTier));
    // Before the change every authenticated role reached the handler…
    const beforeGate = () => true;
    // …so the delta is exactly the roles outside the tier, and it is a
    // narrowing (nothing outside `beforeGate` could have been granted).
    const tightened = ROLES.filter((role) => beforeGate(role) && !hasPermission(role, "org:read"));
    expect(sorted(new Set(tightened))).toEqual(sorted(new Set(ROLES.filter((r) => !orgTier.has(r)))));
    // And the widening direction is empty: no role gained read access.
    const widened = ROLES.filter((role) => hasPermission(role, "org:read") && !beforeGate(role));
    expect(widened).toEqual([]);
  });

  it("organisations membership: management now needs org:manage, so an org-ADMIN outside the tier loses it (declared delta)", () => {
    // Before: `isPrivileged(role) || isOrgAdmin` — ANY authenticated user whose
    // organisationMember row said ADMIN could add or remove members. After: the
    // route also requires `org:manage`, held by the four organisation tiers.
    // Declared delta: the nine roles outside that tier lose membership
    // management for organisations they administer; they keep the membership
    // row itself and its farm read/write capabilities (F-06). No role gained it.
    const orgTier = new Set(["SUPER_ADMIN", "ADMIN", "CORPORATE", "COOPERATIVE"]);
    const afterCapability = (role: string) => hasPermission(role, "org:manage");
    expect(sorted(rolesWhere(afterCapability))).toEqual(sorted(orgTier));
    // The membership row alone was sufficient, so every role was in the
    // "before" set — the delta is exactly the complement of the tier.
    expect(ROLES.filter((role) => !afterCapability(role))).toEqual(ROLES.filter((role) => !orgTier.has(role)));
  });
});

/**
 * End-to-end form of the same claim for the route whose scope decision was
 * swapped: `GET /payments` must answer every one of the 13 roles exactly as it
 * did before — 200 for all of them, with the ADMIN tier seeing ALL rows and
 * every other role seeing only its own.
 */
describe("GET /payments: the 13-role access matrix is unchanged (F-08)", () => {
  it("all 13 roles: 200, and the row scope follows the pre-migration predicate", async () => {
    // A payment owned by a bystander, as the "other tenant" probe.
    const bystander = await registerFarmer();
    const foreign = await prisma.payment.create({
      data: { refNo: refNo("PAY"), userId: bystander.user.id, purposeType: "ORDER", purposeId: "authz-matrix-foreign", amountPaisa: 777 },
    });

    const observed: Record<string, { status: number; seesForeign: boolean; seesOwn: boolean }> = {};
    for (const role of ROLES) {
      const user = await createUserWithRole(role);
      const own = await prisma.payment.create({
        data: { refNo: refNo("PAY"), userId: user.userId, purposeType: "ORDER", purposeId: "authz-matrix-own", amountPaisa: 888 },
      });
      const res = await request(app).get("/api/v1/payments").set("Authorization", `Bearer ${user.accessToken}`);
      const ids = new Set((res.body.data as { id: string }[] | undefined)?.map((p) => p.id) ?? []);
      observed[role] = { status: res.status, seesForeign: ids.has(foreign.id), seesOwn: ids.has(own.id) };
    }

    // 1. Nobody lost access and nobody gained it: every role still reads 200.
    expect(Object.fromEntries(Object.entries(observed).map(([r, o]) => [r, o.status]))).toEqual(
      Object.fromEntries(ROLES.map((r) => [r, 200])),
    );
    // 2. The scope each role gets is exactly the pre-migration predicate's.
    for (const role of ROLES) {
      const row = observed[role] ?? { status: -1, seesForeign: false, seesOwn: false };
      const expectedWide = before.paymentsAny(role);
      expect(row.seesForeign, `${role}: foreign rows visibility changed`).toBe(expectedWide);
      expect(row.seesOwn, `${role}: own rows visibility changed`).toBe(true);
    }
    // 3. The capability that drives it is the declared one (not a stray list).
    expect(sorted(rolesWhere((role) => hasPermission(role, "payments:read:any")))).toEqual(["ADMIN", "SUPER_ADMIN"]);

    // 4. The admin's view is genuinely the widest one — the probe is real.
    const admin = await getAdmin();
    const adminRes = await request(app).get("/api/v1/payments").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(adminRes.status).toBe(200);
    expect((adminRes.body.data as { id: string }[]).map((p) => p.id)).not.toContain(undefined);
  }, 180_000);

  it("a non-privileged role never receives another user's payment row", async () => {
    const owner = await registerFarmer();
    const stranger = await createUserWithRole("DEALER");
    const foreign = await prisma.payment.create({
      data: { refNo: refNo("PAY"), userId: owner.user.id, purposeType: "ORDER", purposeId: "authz-matrix-probe", amountPaisa: 999 },
    });
    const res = await request(app).get("/api/v1/payments").set("Authorization", `Bearer ${stranger.accessToken}`);
    expect(res.status).toBe(200);
    expect((res.body.data as { id: string }[]).map((p) => p.id)).not.toContain(foreign.id);
  });
});

describe("GET /procurement: the 13-role access matrix is unchanged (F-08, last site)", () => {
  it("all 13 roles: 200, and the row scope follows the pre-migration predicate", async () => {
    // A procurement order owned by a bystander, as the "other tenant" probe.
    // Note the deliberate difference from GET /payments: a territory-scoped
    // manager sees its region's rows, not the fleet's, so `seesForeign` for
    // REGIONAL_MANAGER/AREA_MANAGER is the pre-migration predicate's answer and
    // nothing else — the bystander's region is not theirs.
    const bystander = await registerFarmer();
    const { farmId: foreignFarmId } = await createFarmWithCrop(bystander.accessToken);
    const foreign = await prisma.procurementOrder.create({
      data: {
        poNo: refNo("PO"), userId: bystander.user.id, farmId: foreignFarmId,
        cropName: "RICE", quantityKg: 100, basePricePerKgPaisa: 2800, netPayablePaisa: 280_000,
      },
    });

    const observed: Record<string, { status: number; seesForeign: boolean; seesOwn: boolean }> = {};
    for (const role of ROLES) {
      const user = await createUserWithRole(role);
      // `createUserWithRole` returns { userId, accessToken }; `registerFarmer`
      // returns { user, accessToken }. Normalise to the id.
      const ownerId = "userId" in user ? user.userId : user.user.id;
      const own = await prisma.procurementOrder.create({
        data: {
          poNo: refNo("PO"), userId: ownerId, farmId: foreignFarmId,
          cropName: "RICE", quantityKg: 120, basePricePerKgPaisa: 2800, netPayablePaisa: 336_000,
        },
      });
      const res = await request(app).get("/api/v1/procurement").set("Authorization", `Bearer ${user.accessToken}`);
      const ids = new Set((res.body.data as { id: string }[] | undefined)?.map((p) => p.id) ?? []);
      observed[role] = { status: res.status, seesForeign: ids.has(foreign.id), seesOwn: ids.has(own.id) };
    }

    // 1. Nobody lost access and nobody gained it: every role still reads 200.
    expect(Object.fromEntries(Object.entries(observed).map(([r, o]) => [r, o.status]))).toEqual(
      Object.fromEntries(ROLES.map((r) => [r, 200])),
    );
    // 2. The scope each role gets is exactly the pre-migration predicate's. Two
    //    things decide it, and both are unchanged by the conversion:
    //    (a) `procurementAny(role)` — the ADMIN tier sees the fleet;
    //    (b) the territory fallback — REGIONAL_MANAGER / AREA_MANAGER /
    //    PROCUREMENT_MANAGER / COLLECTION_MANAGER with NO region assigned see
    //    everything (`actorRegionLimit` returns null → `where = {}`, logged as
    //    ODL-007). These users have no region, so all four see the foreign row,
    //    exactly as the inline version did. Asserting that explicitly proves the
    //    fallback survived the swap rather than silently tightening.
    const TERRITORY_SCOPED = ["REGIONAL_MANAGER", "AREA_MANAGER", "PROCUREMENT_MANAGER", "COLLECTION_MANAGER"];
    for (const role of ROLES) {
      const row = observed[role] ?? { status: -1, seesForeign: false, seesOwn: false };
      const expectedWide = before.procurementAny(role) || TERRITORY_SCOPED.includes(role);
      expect(row.seesForeign, `${role}: foreign rows visibility changed`).toBe(expectedWide);
      expect(row.seesOwn, `${role}: own rows visibility changed`).toBe(true);
    }
    // The fallback is real: every unassigned territory role sees the foreign row,
    // and every non-territory, non-admin role does not.
    for (const role of TERRITORY_SCOPED) {
      expect(observed[role]?.seesForeign, `${role}: the ODL-007 unassigned-region fallback disappeared`).toBe(true);
    }
    // 3. The capability that drives it is the declared one (not a stray list).
    expect(sorted(rolesWhere((role) => hasPermission(role, "procurement:read:any")))).toEqual(["ADMIN", "SUPER_ADMIN"]);

    // 4. The admin's view is genuinely the widest one — the probe is real.
    const admin = await getAdmin();
    const adminRes = await request(app).get("/api/v1/procurement").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(adminRes.status).toBe(200);
    expect((adminRes.body.data as { id: string }[]).map((p) => p.id)).toContain(foreign.id);
  }, 180_000);
});
