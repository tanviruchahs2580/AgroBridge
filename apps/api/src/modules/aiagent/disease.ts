import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { badRequest, notFound, forbidden } from "../../lib/errors.js";
import { ok } from "../../middleware/context.js";
import { notify } from "../../providers/notification/service.js";

export const diseaseRouter = Router();
diseaseRouter.use(requireAuth);

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE_BYTES = 8 * 1024 * 1024;

/**
 * Disease detection workflow (Section 14):
 * Image upload -> basic quality checks -> heuristic triage -> persisted case.
 * The classification itself is provider-abstracted; without a trained model
 * configured the case is queued as PENDING_REVIEW for agronomist review and
 * NEVER presented as a confirmed AI diagnosis (Rule 53).
 */
diseaseRouter.post(
  "/cases",
  async (req, res, next) => {
    try {
      const contentType = req.headers["content-type"] ?? "";
      if (!contentType.includes("multipart/form-data")) {
        throw badRequest("multipart/form-data with an image file is required");
      }

      // Minimal multipart parser for a single "image" part (no external dep).
      const buffer = await readRawBody(req);
      const parsed = parseMultipart(buffer);
      const imagePart = parsed.find((p) => p.name === "image");
      const cropCycleId = parsed.find((p) => p.name === "cropCycleId")?.value;
      const cropGuess = parsed.find((p) => p.name === "cropGuess")?.value;

      if (!imagePart?.data || !imagePart.mime) throw badRequest("Field 'image' is required");
      if (!ALLOWED_MIME.has(imagePart.mime)) throw badRequest("Only JPEG/PNG/WebP images accepted");
      if (imagePart.data.length > MAX_SIZE_BYTES) throw badRequest("Image exceeds 8MB limit");
      // Magic byte sanity check
      const sig = imagePart.data.subarray(0, 4);
      const looksImage =
        (sig[0] === 0xff && sig[1] === 0xd8) || // jpeg
        sig.toString("ascii").startsWith("RIFF") || // webp
        (sig[0] === 0x89 && sig[1] === 0x50); // png
      if (!looksImage) throw badRequest("File content is not a valid image");

      let cropCycleIdValidated: string | undefined;
      if (cropCycleId) {
        const cycle = await prisma.cropCycle.findFirst({
          where: { id: cropCycleId, plot: { farm: { ownerId: req.auth!.userId } } },
        });
        if (!cycle) throw forbidden("Invalid cropCycleId for this farmer");
        cropCycleIdValidated = cycle.id;
      }

      const uploadDir = path.resolve("uploads/disease");
      await mkdir(uploadDir, { recursive: true });
      const ext = imagePart.mime === "image/png" ? ".png" : imagePart.mime === "image/webp" ? ".webp" : ".jpg";
      const fileName = `${randomUUID()}${ext}`;
      await writeFile(path.join(uploadDir, fileName), imagePart.data);

      const kase = await prisma.diseaseCase.create({
        data: {
          userId: req.auth!.userId,
          cropCycleId: cropCycleIdValidated,
          imagePath: `uploads/disease/${fileName}`,
          cropGuess,
          status: "PENDING_REVIEW",
          confidence: null,
          diagnosis: null,
          recommendation:
            "ছবিটি কৃষি বিশেষজ্ঞের পর্যালোচনার জন্য পাঠানো হয়েছে। ফলাফল পাওয়ার আগে কোনো ওষুধ প্রয়োগ করবেন না। / Your photo has been queued for agronomist review. Do not apply any treatment until results arrive.",
        },
      });

      await notify({
        userId: req.auth!.userId,
        type: "AI",
        titleBn: "রোগ নির্ণয়ের অনুরোধ গৃহীত",
        titleEn: "Disease review request received",
        bodyBn: "আপনার ছবি বিশেষজ্ঞ পর্যালোচনার জন্য সারিতে আছে।",
        bodyEn: "Your image is queued for expert review.",
        refType: "DISEASE_CASE",
        refId: kase.id,
      });

      ok(res, kase, 201);
    } catch (e) {
      next(e);
    }
  }
);

diseaseRouter.get("/cases", async (req, res, next) => {
  try {
    const cases = await prisma.diseaseCase.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    ok(res, cases);
  } catch (e) {
    next(e);
  }
});

diseaseRouter.get("/cases/:id", async (req, res, next) => {
  try {
    const where =
      req.auth!.role === "ADMIN" || req.auth!.role === "SUPER_ADMIN"
        ? { id: req.params.id! }
        : { id: req.params.id!, userId: req.auth!.userId };
    const kase = await prisma.diseaseCase.findFirst({ where });
    if (!kase) throw notFound("Disease case");
    ok(res, kase);
  } catch (e) {
    next(e);
  }
});

// Agronomist/admin review endpoint
const reviewSchema = z.object({
  diagnosis: z.string().trim().min(3).max(500),
  severity: z.enum(["LOW", "MODERATE", "HIGH"]),
  recommendation: z.string().trim().min(5).max(2000),
});

diseaseRouter.post("/cases/:id/review", validate({ body: reviewSchema }), async (req, res, next) => {
  try {
    if (!(req.auth!.role === "ADMIN" || req.auth!.role === "SUPER_ADMIN")) {
      throw forbidden("Only reviewers may finalize diagnoses");
    }
    const kase = await prisma.diseaseCase.findUnique({ where: { id: req.params.id! } });
    if (!kase) throw notFound("Disease case");

    const updated = await prisma.diseaseCase.update({
      where: { id: kase.id },
      data: { ...(req.body as object), status: "REVIEWED", reviewedBy: req.auth!.userId, reviewedAt: new Date() } as never,
    });

    await notify({
      userId: kase.userId,
      type: "AI",
      titleBn: "রোগ নির্ণয়ের ফলাফল এসেছে",
      titleEn: "Disease diagnosis result ready",
      refType: "DISEASE_CASE",
      refId: kase.id,
    });

    ok(res, updated);
  } catch (e) {
    next(e);
  }
});

// ---- minimal multipart helpers (avoid heavy deps) ----
function readRawBody(req: import("express").Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_SIZE_BYTES * 2) {
        reject(badRequest("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

interface Part {
  name: string;
  value?: string;
  mime?: string;
  data?: Buffer;
}

function parseMultipart(body: Buffer): Part[] {
  // Boundary comes from the first line of the body ("--...").
  const firstLineEnd = body.indexOf("\r\n");
  if (firstLineEnd < 0) throw badRequest("Malformed multipart payload");
  const dashBoundary = body.subarray(0, firstLineEnd).toString();
  const delimiter = Buffer.from("\r\n" + dashBoundary);
  const parts: Part[] = [];

  let start = firstLineEnd + 2;
  while (start < body.length) {
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const segment = body.subarray(start, next);
    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd > 0) {
      const headersRaw = segment.subarray(0, headerEnd).toString();
      const data = segment.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/i.exec(headersRaw);
      const fileMatch = /filename="([^"]*)"/i.exec(headersRaw);
      const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headersRaw);
      if (fileMatch) {
        parts.push({
          name: nameMatch?.[1] ?? "",
          mime: mimeMatch?.[1]?.trim().toLowerCase(),
          data: data.subarray(0, data.length - 2), // strip trailing \r\n
        });
      } else if (nameMatch) {
        parts.push({ name: nameMatch[1], value: data.subarray(0, Math.max(0, data.length - 2)).toString() });
      }
    }
    start = next + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break; // closing boundary
  }
  return parts;
}
