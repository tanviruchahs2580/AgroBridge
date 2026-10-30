import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { userOrIpKey } from "../../middleware/rateLimitKeys.js";
import { rateLimitHandler } from "../../middleware/rateLimitResponse.js";
import { badRequest, notFound, forbidden, conflict } from "../../shared/errors/index.js";
import { requirePermission, hasPermission } from "../../middleware/rbac.js";
import { audit } from "../../middleware/audit.js";
import { ok } from "../../middleware/context.js";
import { getStorageProvider } from "../../providers/storage/index.js";
import { removeStoredUpload } from "../../providers/storage/cleanup.js";
import { stripJpegMetadata } from "../../shared/utils/jpeg.js";
import { notify } from "../../providers/notification/service.js";
import { getAuth } from "../../shared/auth-context.js";
import { env } from "../../config/env.js";
import { createRedisStore } from "../../lib/rateLimitRedis.js";

export const diseaseRouter = Router();
diseaseRouter.use(requireAuth);

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE_BYTES = 8 * 1024 * 1024;

/** Accepted photo uploads per user per hour (SEC-11). */
export const DISEASE_UPLOAD_LIMIT_PER_HOUR = 20;

// Shared window store when Redis is configured — same multi-instance-safe
// pattern as the auth limiters (a per-instance window could be multiplied by
// the number of pods).
const uploadStore = env.REDIS_URL ? createRedisStore(env.REDIS_URL, 60 * 60 * 1000, "disease-upload") : undefined;

/**
 * Per-user upload limiter (SEC-11): each accepted photo writes a file
 * (disk/S3/db row) plus a disease-case row, so this is the most expensive
 * per-user write path outside money. Keyed by the authenticated user (like
 * otpVerifyLimiter — requireAuth runs first) and deliberately NOT skipped in
 * tests, so the 429 envelope is exercised for real.
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: DISEASE_UPLOAD_LIMIT_PER_HOUR,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  store: uploadStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many photo uploads. Please try again later." } },
  handler: rateLimitHandler,
});

/**
 * Disease detection workflow:
 * Image upload -> basic quality checks -> heuristic triage -> persisted case.
 * The classification itself is provider-abstracted; without a trained model
 * configured the case is queued as PENDING_REVIEW for agronomist review and
 * NEVER presented as a confirmed AI diagnosis.
 */
diseaseRouter.post(
  "/cases",
  uploadLimiter,
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
      // Magic-byte check on the FULL format signature, not a loose prefix:
      // "RIFF…" alone accepts any RIFF container (WAV/AVI) as WebP, and two
      // bytes accept unrelated 0x89/0x50 streams as PNG. Deep signatures
      // keep non-image payloads from occupying upload storage.
      const buf = imagePart.data;
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const isWebp =
        buf.length >= 12 &&
        buf.toString("ascii", 0, 4) === "RIFF" &&
        buf.toString("ascii", 8, 12) === "WEBP";
      const isPng =
        buf.length >= 8 &&
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
        buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
      // The format is what the BYTES are, not what the client declared. The
      // declared Content-Type is attacker-controlled, so deciding whether to
      // strip metadata from it let a real JPEG labelled image/png keep its
      // APP1/EXIF (GPS, device) segments and be stored under a .png name
      // (AUD-104). One sniffed value now drives the stripping, the extension
      // and the stored content type, so the three cannot disagree.
      const format: "jpeg" | "png" | "webp" | null = isJpeg ? "jpeg" : isPng ? "png" : isWebp ? "webp" : null;
      if (!format) throw badRequest("File content is not a valid image");

      let cropCycleIdValidated: string | undefined;
      if (cropCycleId) {
        const cycle = await prisma.cropCycle.findFirst({
          where: { id: cropCycleId, plot: { farm: { ownerId: getAuth(req).userId } } },
        });
        if (!cycle) throw forbidden("Invalid cropCycleId for this farmer");
        cropCycleIdValidated = cycle.id;
      }

      if (cropGuess && cropGuess.length > 120) throw badRequest("cropGuess too long");

      // strip EXIF (APP1 — GPS/device/timestamps) from JPEGs before the
      // bytes are stored. PNG/WebP pass through unchanged: the audit-flagged
      // leak is the camera EXIF in JPEGs, and neither format can carry APP1
      // segments; their own metadata chunks are a recorded residual.
      // A JPEG that cannot be parsed is rejected rather than stored unclean.
      let upload = imagePart.data;
      if (format === "jpeg") {
        try {
          upload = stripJpegMetadata(imagePart.data);
        } catch {
          throw badRequest("Malformed JPEG image — metadata could not be verified and removed");
        }
      }

      // Storage abstraction: local disk in dev, S3-compatible in production.
      const ext = format === "png" ? ".png" : format === "webp" ? ".webp" : ".jpg";
      const storedContentType = format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
      const fileName = `${randomUUID()}${ext}`;
      const imagePath = `uploads/disease/${fileName}`;
      await getStorageProvider().save(fileName, upload, storedContentType);

      // orphan cleanup: if persisting the case fails, the just-stored
      // bytes have no DB row referencing them — remove them best-effort so a
      // failed request cannot leak files forever (failure is logged by the
      // helper; the original error is what the client sees).
      const kase = await prisma.diseaseCase
        .create({
          data: {
            userId: getAuth(req).userId,
            cropCycleId: cropCycleIdValidated,
            imagePath,
            cropGuess,
            status: "PENDING_REVIEW",
            confidence: null,
            diagnosis: null,
            recommendation:
              "ছবিটি কৃষি বিশেষজ্ঞের পর্যালোচনার জন্য পাঠানো হয়েছে। ফলাফল পাওয়ার আগে কোনো ওষুধ প্রয়োগ করবেন না। / Your photo has been queued for agronomist review. Do not apply any treatment until results arrive.",
          },
        })
        .catch(async (e: unknown) => {
          await removeStoredUpload(imagePath, `disease-case-create-failed:${getAuth(req).userId}`);
          throw e;
        });

      await notify({
        userId: getAuth(req).userId,
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
      where: { userId: getAuth(req).userId },
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
      getAuth(req).role === "ADMIN" || getAuth(req).role === "SUPER_ADMIN"
        ? { id: req.params.id }
        : { id: req.params.id, userId: getAuth(req).userId };
    const kase = await prisma.diseaseCase.findFirst({ where });
    if (!kase) throw notFound("Disease case");
    ok(res, kase);
  } catch (e) {
    next(e);
  }
});

/** Params contract for the /:id routes (mirrors the payments module). */
const idParams = z.object({ id: z.string().min(1).max(64) });

/**
 * The stored photo of a case (AUD-201). Before this route the bytes had no
 * read path at all — neither the farmer could see their own photo again nor an
 * agronomist could review what they were asked to diagnose, so the advertised
 * review workflow could not practically complete.
 *
 * Access: the owner, or a holder of `disease:review` (admin/agronomist). A
 * non-owner gets 404 rather than 403 — the endpoint must not double as an
 * existence oracle for other people's case ids. The stored extension decides
 * the content type; it is set from the byte-sniffed format at upload time
 * (AUD-104), so it cannot disagree with the bytes.
 */
diseaseRouter.get(
  "/cases/:id/image",
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      const auth = getAuth(req);
      const reviewer = hasPermission(auth.role, "disease:review");
      const kase = await prisma.diseaseCase.findFirst({
        where: reviewer ? { id: req.params.id } : { id: req.params.id, userId: auth.userId },
        select: { imagePath: true, userId: true },
      });
      if (!kase) throw notFound("Disease case");

      // A reviewer reading a farmer's photo is a privileged cross-user read of
      // personal data (the image can include the farm itself). The review
      // decision is audited; the read that makes it possible is logged too.
      if (reviewer && kase.userId !== auth.userId) {
        await audit({
          actorId: auth.userId,
          action: "DISEASE_IMAGE_VIEWED",
          entityType: "DiseaseCase",
          entityId: req.params.id,
          meta: { ownerUserId: kase.userId },
        });
      }

      const bytes = await getStorageProvider().get(kase.imagePath);
      if (!bytes) throw notFound("Image");

      const lower = kase.imagePath.toLowerCase();
      const contentType = lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(bytes.length));
      // Private: the case belongs to one farmer; intermediaries must not cache it.
      res.setHeader("Cache-Control", "private, max-age=300");
      // Render in-place; never offer it as a download with a client-chosen name.
      res.setHeader("Content-Disposition", "inline");
      res.send(bytes);
    } catch (e) {
      next(e);
    }
  }
);

// Agronomist/admin review endpoint
const reviewSchema = z.object({
  diagnosis: z.string().trim().min(3).max(500),
  severity: z.enum(["LOW", "MODERATE", "HIGH"]),
  recommendation: z.string().trim().min(5).max(2000),
});

diseaseRouter.post(
  "/cases/:id/review",
  requirePermission("disease:review"),
  validate({ body: reviewSchema }),
  async (req, res, next) => {
    try {
      const kase = await prisma.diseaseCase.findUnique({ where: { id: req.params.id } });
      if (!kase) throw notFound("Disease case");

      const review = req.body as z.infer<typeof reviewSchema>;
      // Reviewing is final, and the claim is atomic: two racing agronomists
      // both passed the old pre-check and the second silently overwrote the
      // first. The updateMany predicate is the gate — exactly one PENDING_REVIEW
      // transition wins (AUD-V3).
      const claimed = await prisma.diseaseCase.updateMany({
        where: { id: kase.id, status: "PENDING_REVIEW" },
        data: {
          // Exactly the schema's three fields, plus the server-set audit trio.
          diagnosis: review.diagnosis,
          severity: review.severity,
          recommendation: review.recommendation,
          status: "REVIEWED",
          reviewedBy: getAuth(req).userId,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        const current = await prisma.diseaseCase.findUniqueOrThrow({ where: { id: kase.id }, select: { status: true } });
        throw conflict(`Case already ${current.status}`);
      }
      const updated = await prisma.diseaseCase.findUniqueOrThrow({ where: { id: kase.id } });

      // The diagnosis decision itself is the auditable event.
      await audit({
        actorId: getAuth(req).userId,
        action: "DISEASE_REVIEWED",
        entityType: "DiseaseCase",
        entityId: kase.id,
        meta: { severity: (req.body as { severity?: string }).severity },
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
  }
);

// ---- minimal multipart helpers (avoid heavy deps) ----
function readRawBody(req: import("express").Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      // Raw ceiling: the 8MB image plus envelope overhead (boundary + headers).
      if (size > MAX_SIZE_BYTES + 64 * 1024) {
        // Stop buffering but KEEP consuming the stream so the client can read
        // our 400 response — destroying the socket mid-body surfaces as an
        // opaque ECONNRESET instead of an actionable error.
        oversized = true;
        return;
      }
      if (!oversized) chunks.push(c);
    });
    req.on("end", () => {
      if (oversized) reject(badRequest("Payload too large"));
      else resolve(Buffer.concat(chunks));
    });
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
        // Strip the trailing CRLF only when it is actually the part delimiter;
        // never truncate real bytes off a malformed-but-parseable payload.
        const endsCrlf =
          data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10;
        parts.push({
          name: nameMatch?.[1] ?? "",
          mime: mimeMatch?.[1]?.trim().toLowerCase(),
          data: endsCrlf ? data.subarray(0, data.length - 2) : data,
        });
      } else if (nameMatch) {
        const endsCrlf =
          data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10;
        parts.push({ name: nameMatch[1], value: (endsCrlf ? data.subarray(0, data.length - 2) : data).toString() });
      }
    }
    start = next + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break; // closing boundary
  }
  return parts;
}
