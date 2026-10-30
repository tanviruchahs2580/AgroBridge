// Ground truth for ADM-01: recomputes the admin dashboard's metric definitions
// directly from the acceptance database so the dashboard can be compared with
// what the data says — not with itself.
// Usage: node apps/web/e2e/admin-ground-truth.mjs <sqlite-file-url>
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.argv[2] ?? path.resolve(here, "../../api/prisma/test.db");
const url = dbFile.startsWith("file:") ? dbFile : `file:${dbFile}`;

const prisma = new PrismaClient({ datasources: { db: { url } } });
const [farmers, activeFarmers, farms, activeCrops, orders, bookings, pendingProcurement, revenue, aiAdvisoryQueries] =
  await Promise.all([
    prisma.user.count({ where: { role: "FARMER" } }),
    prisma.user.count({ where: { role: "FARMER", status: "ACTIVE" } }),
    prisma.farm.count(),
    prisma.cropCycle.count({ where: { status: "ACTIVE" } }),
    prisma.order.count(),
    prisma.booking.count(),
    prisma.procurementOrder.count({ where: { status: { in: ["SUBMITTED", "QC"] } } }),
    prisma.payment.aggregate({ where: { status: "SUCCEEDED", purposeType: { not: "PROCUREMENT" } }, _sum: { amountPaisa: true } }),
    prisma.advisoryQuery.count(),
  ]);
await prisma.$disconnect();
console.log(
  JSON.stringify({
    farmers,
    activeFarmers,
    farms,
    activeCrops,
    orders,
    bookings,
    pendingProcurement,
    revenuePaisa: revenue._sum.amountPaisa ?? 0,
    aiAdvisoryQueries,
  })
);
