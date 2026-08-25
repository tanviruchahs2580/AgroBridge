import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { ok } from "../../middleware/context.js";

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["COOPERATIVE", "CORPORATE", "NGO", "GOVT"]),
  district: z.string().trim().max(60).optional(),
});

organizationsRouter.post("/", validate({ body: createOrgSchema }), async (req, res, next) => {
  try {
    // Only ADMIN/SUPER_ADMIN or CORPORATE/COOPERATIVE can create orgs; farmers can be invited but not create
    if (!["SUPER_ADMIN", "ADMIN", "CORPORATE", "COOPERATIVE"].includes(req.auth!.role)) {
      throw forbidden("Only admins or corporate/cooperative users may create organizations");
    }
    const body = req.body as z.infer<typeof createOrgSchema>;
    const org = await prisma.organization.create({
      data: {
        name: body.name,
        type: body.type,
        district: body.district,
        members: { create: { userId: req.auth!.userId, role: "ADMIN" } },
      },
    });
    ok(res, org, 201);
  } catch (e) {
    next(e);
  }
});

organizationsRouter.get("/", async (req, res, next) => {
  try {
    const isPrivileged = ["SUPER_ADMIN", "ADMIN"].includes(req.auth!.role);
    const orgs = await prisma.organization.findMany({
      where: isPrivileged ? {} : { members: { some: { userId: req.auth!.userId } } },
      include: { members: { include: { user: { select: { id: true, fullName: true, role: true } } } }, _count: { select: { farms: true } } },
      orderBy: { createdAt: "desc" },
    });
    ok(res, orgs);
  } catch (e) {
    next(e);
  }
});

organizationsRouter.get("/:id", async (req, res, next) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id! },
      include: { members: { include: { user: { select: { id: true, fullName: true, role: true } } } } },
    });
    if (!org) throw notFound("Organization");
    const isPrivileged = ["SUPER_ADMIN", "ADMIN"].includes(req.auth!.role);
    const isMember = org.members.some((m) => m.userId === req.auth!.userId);
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

organizationsRouter.post("/:id/members", validate({ body: addMemberSchema }), async (req, res, next) => {
  try {
    const orgId = req.params.id!;
    const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { members: true } });
    if (!org) throw notFound("Organization");
    const isPrivileged = ["SUPER_ADMIN", "ADMIN"].includes(req.auth!.role);
    const isOrgAdmin = org.members.some((m) => m.userId === req.auth!.userId && m.role === "ADMIN");
    if (!isPrivileged && !isOrgAdmin) throw forbidden("Only org admins may add members");
    const { userId, role } = req.body as z.infer<typeof addMemberSchema>;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User");
    const member = await prisma.organizationMember.create({ data: { organizationId: orgId, userId, role } });
    ok(res, member, 201);
  } catch (e) {
    next(e);
  }
});

organizationsRouter.delete("/:id/members/:userId", async (req, res, next) => {
  try {
    const orgId = req.params.id!;
    const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { members: true } });
    if (!org) throw notFound("Organization");
    const isPrivileged = ["SUPER_ADMIN", "ADMIN"].includes(req.auth!.role);
    const isOrgAdmin = org.members.some((m) => m.userId === req.auth!.userId && m.role === "ADMIN");
    if (!isPrivileged && !isOrgAdmin) throw forbidden("Only org admins may remove members");
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId, userId: req.params.userId! } });
    ok(res, { removed: true });
  } catch (e) {
    next(e);
  }
});

organizationsRouter.get("/:id/farms", async (req, res, next) => {
  try {
    const orgId = req.params.id!;
    const org = await prisma.organization.findUnique({ where: { id: orgId }, include: { members: true } });
    if (!org) throw notFound("Organization");
    const isPrivileged = ["SUPER_ADMIN", "ADMIN"].includes(req.auth!.role);
    const isMember = org.members.some((m) => m.userId === req.auth!.userId);
    if (!isPrivileged && !isMember) throw forbidden("Not a member");
    const farms = await prisma.farm.findMany({ where: { organizationId: orgId }, include: { plots: true }, orderBy: { createdAt: "desc" } });
    ok(res, farms);
  } catch (e) {
    next(e);
  }
});
