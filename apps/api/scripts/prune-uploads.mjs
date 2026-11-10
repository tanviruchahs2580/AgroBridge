#!/usr/bin/env node
/**
 * Prunes orphaned disease-upload files: deletes anything older than 7 days
 * that no DiseaseCase row references.
 *
 * Where it runs (2026-11-10): this is a HOST-side tool for a deployment that
 * keeps uploads on a local filesystem (`STORAGE_PROVIDER=local`, docs/deployment.md
 * §4). The previous header suggested `0 3 * * * cd /srv/agrobridge/apps/api` — an
 * invented host; production is Vercel + Neon, where STORAGE_PROVIDER=db stores
 * objects in the database and there is no `uploads/` directory to prune (the
 * retention endpoint's purge queue removes those). Run it from a checkout on the
 * machine that owns the files: `cd apps/api && node scripts/prune-uploads.mjs`.
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
