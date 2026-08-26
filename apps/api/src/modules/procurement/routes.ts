import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { forbidden, notFound, unprocessable } from "../../lib/errors.js";
import { ok } from "../../middleware/context.js";
import { refNo, calcProcurement } from "../../lib/money.js";
import { notify } from "../../providers/notification/service.js";

export const procurementRouter = Router();
procurementRouter.use(requireAuth);

const submitSchema = z.object({
  farmId: z.string().min(5),
  cropName: z.string().trim().min(2).max(80),
  quantityKg: z.number().positive().max(1_000_000),
  moisturePct: z.number().min(0).max(60).optional(),
  qualityGrade: z.enum(["A", "B", "C"]),
  notes: z.string().trim().max(1000).optional(),
});

const CATALOGUE_BASE_PAISA_PER_KG: Record<string, number> = {
  RICE: 3200, WHEAT: 2800, JUTE: 5500, MUSTARD: 6000, MAIZE: 2200, POTATO: 1500,
};

procurementRouter.post(
  "/offers",
  validate({ body: submitSchema }),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof submitSchema>;
      const farm = await prisma.farm.findFirst({ where: { id: b.farmId, ownerId: req.auth!.userId } });
      if (!farm) throw forbidden("Farm not found in your account");

      const key = b.cropName.toUpperCase();
      const basePricePerKgPaisa = CATALOGUE_BASE_PAISA_PER_KG[key];
      if (!basePricePerKgPaisa) {
        throw unprocessable(`Crop '${b.cropName}' is not in the procurement catalogue. Supported: ${Object.keys(CATALOGUE_BASE_PAISA_PER_KG).join(", ")}`);
      }

      // Auditable price calculation (Section 19)
      const calc = calcProcurement({
        quantityKg: b.quantityKg,
        basePricePerKgPaisa,
        grade: b.qualityGrade,
        moisturePct: b.moisturePct,
      });

      const po = await prisma.procurementOrder.create({
        data: {
          poNo: refNo("PRC"),
          userId: req.auth!.userId,
          farmId: farm.id,
          cropName: key,
          quantityKg: b.quantityKg,
          moisturePct: b.moisturePct,
          qualityGrade: b.qualityGrade,
          basePricePerKgPaisa,
          deductionsPaisa: calc.deductionsPaisa,
          netPayablePaisa: calc.netPayablePaisa,
          notes: b.notes,
        },
      });

      await notify({
        userId: req.auth!.userId,
        type: "PROCUREMENT",
        titleBn: `ফসলের অফার গৃহীত (${po.poNo})`,
        titleEn: `Crop offer submitted (${po.poNo})`,
        bodyBn: "গুণগত যাচাইয়ের পর ক্রয়াদেশ জারি হবে।",
        bodyEn: "A purchase order will be issued after quality check.",
        refType: "PROCUREMENT_ORDER",
        refId: po.id,
      });

      ok(res, { ...po, calculation: { grossPaisa: calc.grossPaisa, deductionsPaisa: calc.deductionsPaisa, netPayablePaisa: calc.netPayablePaisa } }, 201);
    } catch (e) {
      next(e);
    }
  }
);

procurementRouter.get("/", async (req, res, next) => {
  try {
    // Queue visibility: admins see all; procurement/area/collection managers
    // see their territory (user.region) or everything while unassigned;
    // farmers see only their own offers.
    const role = req.auth!.role;
    let where: Record<string, unknown>;
    if (["ADMIN", "SUPER_ADMIN"].includes(role)) {
      where = {};
    } else if (["PROCUREMENT_MANAGER", "AREA_MANAGER", "COLLECTION_MANAGER", "REGIONAL_MANAGER"].includes(role)) {
      const me = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { region: true } });
      where = me?.region ? { user: { region: me.region } } : {};
    } else {
      where = { userId: req.auth!.userId };
    }
    const pos = await prisma.procurementOrder.findMany({
      where,
      include: { farm: { select: { name: true } }, user: { select: { fullName: true, phone: true, region: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    ok(res, pos);
  } catch (e) {
    next(e);
  }
});

// Review workflow: SUBMITTED -> QC -> PURCHASE_ORDER -> COLLECTED -> PAID
const reviewSchema = z.object({
  action: z.enum(["QC_PASS", "ISSUE_PO", "COLLECT", "REJECT"]),
  qcNotes: z.string().trim().max(1000).optional(),
});

procurementRouter.post("/:id/review", requirePermission("procurement:review"), validate({ body: reviewSchema }), async (req, res, next) => {
  try {
    const po = await prisma.procurementOrder.findUnique({ where: { id: req.params.id! } });
    if (!po) throw notFound("Procurement order");
    const { action, qcNotes } = req.body as z.infer<typeof reviewSchema>;

    const transitions: Record<string, { from: string[]; to: string }> = {
      QC_PASS: { from: ["SUBMITTED"], to: "QC" },
      ISSUE_PO: { from: ["QC"], to: "PURCHASE_ORDER" },
      COLLECT: { from: ["PURCHASE_ORDER"], to: "COLLECTED" },
      REJECT: { from: ["SUBMITTED", "QC", "PURCHASE_ORDER"], to: "REJECTED" },
    };
    const t = transitions[action];
    if (!t.from.includes(po.status)) {
      throw unprocessable(`Cannot ${action} from status ${po.status}`);
    }

    // Transactional conditional transition: prevents two reviewers racing
    // past each other (check-then-write TOCTOU).
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.procurementOrder.updateMany({
        where: { id: po.id, status: { in: t.from } },
        data: { status: t.to, qcNotes: qcNotes ?? po.qcNotes },
      });
      if (claimed.count !== 1) throw unprocessable(`Cannot ${action} from status ${po.status}`);
      return tx.procurementOrder.findUniqueOrThrow({ where: { id: po.id } });
    });

    await notify({
      userId: po.userId,
      type: "PROCUREMENT",
      titleBn: `ক্রয়াদেশ আপডেট (${po.poNo})`,
      titleEn: `Procurement update (${po.poNo})`,
      bodyBn: `বর্তমান অবস্থা: ${t.to}`,
      bodyEn: `Status: ${t.to}`,
      refType: "PROCUREMENT_ORDER",
      refId: po.id,
    });
    ok(res, updated);
  } catch (e) {
    next(e);
  }
});
