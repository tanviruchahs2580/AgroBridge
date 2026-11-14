import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { forbidden, notFound } from "../../shared/errors/index.js";
import { ok } from "../../middleware/context.js";
import { audit } from "../../middleware/audit.js";
import { getAuth } from "../../shared/auth-context.js";

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

/**
 * Nesting caps for org-list responses (F-06, same discipline as FARM_LIST_CAPS
 * in `farms/routes.ts`): they bound ONE response body, never the data — callers
 * get more via pagination/filtering, not an unbounded include. Without them a
 * large organisation (hundreds of members, hundreds of farms) returns an
 * arbitrarily large payload from one request.
 */
export const ORG_LIST_CAPS = { membersPerOrg: 50, farmsPerOrg: 50, plotsPerFarm: 50 } as const;

/**
 * Organisation membership is a second role axis (ADMIN|MEMBER|VIEWER on the
 * membership row), deliberately absent from `contracts/roles.json` — it is not
 * a platform role and grants nothing outside the organisation. The farm
 * capability ladder that consumes it lives in `farms/routes.ts`
 * (`ORG_MEMBER_CAPABILITIES`), where it is enforced; this module only manages
 * the rows.
 *
 * Route gates are declared, not inferred (F-08): the audit found 19 inline
 * role lists the route-role matrix could not see, so `docs/route-role-matrix.md`
 * rendered every route here as "any authenticated role" while the code refused
 * FARMER outright. Platform-admins only (SUPER_ADMIN/ADMIN) keep the bypass they
 * always had.
 */
const isPlatformAdmin = (role: string): boolean => role === "SUPER_ADMIN" || role === "ADMIN"; // authorization-exempt: the platform-admin tier, mirrored by shared/authorization.ts; routes are gated by requirePermission.

const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["COOPERATIVE", "CORPORATE", "NGO", "GOVT"]),
  district: z.string().trim().max(60).optional(),
});

organizationsRouter.post("/", requirePermission("org:manage"), validate({ body: createOrgSchema }), async (req, res, next) => {
  try {
    const actor = getAuth(req);
    // `org:manage` is the coarse gate (CORPORATE/COOPERATIVE/ADMIN tiers — a
    // FARMER holds no permission); only the org-owning tiers may actually
    // found one. The platform-admin bypass is preserved so an operator can
    // create an organisation on a tenant's behalf, exactly as before.
    if (!isPlatformAdmin(actor.role) && !["CORPORATE", "COOPERATIVE"].includes(actor.role)) { // authorization-exempt: narrowing inside a requirePermission("org:manage") route
      throw forbidden("Only admins or corporate/cooperative users may create organizations");
    }
    const body = req.body as z.infer<typeof createOrgSchema>;
    const org = await prisma.organization.create({
      data: {
        name: body.name,
        type: body.type,
        district: body.district,
        members: { create: { userId: actor.userId, role: "ADMIN" } },
      },
    });
    await audit({ actorId: actor.userId, action: "ORG_CREATED", entityType: "Organization", entityId: org.id, meta: { name: org.name, type: org.type } });
    ok(res, org, 201);
  } catch (e) {
    next(e);
  }
});

organizationsRouter.get("/", requirePermission("org:read"), async (req, res, next) => {
  try {
    // `org:read` admits the org-aware tiers; what each may SEE is a row
    // predicate, not a role list: platform admins see every organisation,
    // everyone else only the ones they are a member of.
    const isPrivileged = isPlatformAdmin(getAuth(req).role);
    const orgs = await prisma.organization.findMany({
      where: isPrivileged ? {} : { members: { some: { userId: getAuth(req).userId } } },
      include: {
        members: {
          take: ORG_LIST_CAPS.membersPerOrg,
          include: { user: { select: { id: true, fullName: true, role: true } } },
        },
        // _count.members tells the caller the total despite the truncated
        // nested list — same contract as _count.plots on GET /farms.
        _count: { select: { farms: true, members: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    ok(res, orgs);
  } catch (e) {
    next(e);
  }
});

organizationsRouter.get("/:id", requirePermission("org:read"), validate({ params: z.object({ id: z.string().min(1).max(64) }) }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: { members: { include: { user: { select: { id: true, fullName: true, role: true } } } } },
    });
    if (!org) throw notFound("Organization");
    const isPrivileged = isPlatformAdmin(getAuth(req).role);
    const isMember = org.members.some((m) => m.userId === getAuth(req).userId);
    if (!isPrivileged && !isMember) throw forbidden("Not a member of this organization");
    ok(res, org);
  } catch (e) {
    next(e);
  }
});

const addMemberSchema = z.object({
  userId: z.string().min(5),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
});

organizationsRouter.post("/:id/members", requirePermission("org:manage"), validate({ body: addMemberSchema }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const orgId = req.params.id;
    const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { members: true } });
    if (!org) throw notFound("Organization");
    const actor = getAuth(req);
    const isOrgAdmin = org.members.some((m) => m.userId === actor.userId && m.role === "ADMIN");
    if (!isPlatformAdmin(actor.role) && !isOrgAdmin) throw forbidden("Only org admins may add members");
    const { userId, role } = req.body as z.infer<typeof addMemberSchema>;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User");
    const member = await prisma.organizationMember.create({ data: { organizationId: orgId, userId, role } });
    // Membership rows grant access to the organisation's farm data (F-06), and
    // until F-72 this module wrote no audit trail at all — adding a member was
    // undetectable after the fact.
    await audit({ actorId: actor.userId, action: "ORG_MEMBER_ADDED", entityType: "Organization", entityId: orgId, meta: { userId, role } });
    ok(res, member, 201);
  } catch (e) {
    next(e);
  }
});

organizationsRouter.delete("/:id/members/:userId", requirePermission("org:manage"), validate({ params: z.object({ id: z.string().min(1).max(64), userId: z.string().min(1).max(64) }) }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const orgId = req.params.id;
    const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { members: true } });
    if (!org) throw notFound("Organization");
    const actor = getAuth(req);
    const isOrgAdmin = org.members.some((m) => m.userId === actor.userId && m.role === "ADMIN");
    if (!isPlatformAdmin(actor.role) && !isOrgAdmin) throw forbidden("Only org admins may remove members");
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId, userId: req.params.userId } });
    await audit({ actorId: actor.userId, action: "ORG_MEMBER_REMOVED", entityType: "Organization", entityId: orgId, meta: { userId: req.params.userId } });
    ok(res, { removed: true });
  } catch (e) {
    next(e);
  }
});

organizationsRouter.get("/:id/farms", requirePermission("farm:read:org"), validate({ params: z.object({ id: z.string().min(1).max(64) }) }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const orgId = req.params.id;
    const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { members: true } });
    if (!org) throw notFound("Organization");
    const isPrivileged = isPlatformAdmin(getAuth(req).role);
    const isMember = org.members.some((m) => m.userId === getAuth(req).userId);
    if (!isPrivileged && !isMember) throw forbidden("Not a member");
    const farms = await prisma.farm.findMany({
      where: { organizationId: orgId },
      include: { plots: { take: ORG_LIST_CAPS.plotsPerFarm } },
      orderBy: { createdAt: "desc" },
    });
    ok(res, farms);
  } catch (e) {
    next(e);
  }
});
