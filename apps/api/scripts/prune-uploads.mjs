#!/usr/bin/env node
/**
 * Prunes orphaned disease-upload files: deletes anything older than 7 days
 * that no DiseaseCase row references. Run via cron/systemd timer, e.g.:
 *   0 3 * * * cd /srv/agrobridge/apps/api && node scripts/prune-uploads.mjs
 */
import { readdir, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dir = path.resolve("uploads/disease");
const MAX_AGE_MS = 7 * 24 * 3600_000;

const referenced = new Set(
  (await prisma.diseaseCase.findMany({ select: { imagePath: true } })).map((c) => path.basename(c.imagePath ?? ""))
);

let deleted = 0;
let kept = 0;
for (const file of await readdir(dir)) {
  if (referenced.has(file)) {
    kept++;
    continue;
  }
  const full = path.join(dir, file);
  const s = await stat(full);
  if (Date.now() - s.mtimeMs > MAX_AGE_MS) {
    await unlink(full);
    deleted++;
  } else {
    kept++;
  }
}
console.log(`prune-uploads: deleted=${deleted} kept=${kept} referenced=${referenced.size}`);
await prisma.$disconnect();
