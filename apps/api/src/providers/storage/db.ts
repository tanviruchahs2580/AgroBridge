import { prisma } from "../../lib/prisma.js";
import type { StorageProvider } from "./types.js";

/** Prefix every provider returns from `save` for disease uploads. */
const UPLOAD_PREFIX = "uploads/disease/";

/**
 * Durable storage provider: object bytes live in the database (StoredObject),
 * so uploads survive redeploys on serverless runtimes that have no persistent
 * disk. This is the zero-external-service way to make production durable; the
 * s3 provider remains the target for object storage at higher volumes
 * (ADR-0012).
 */
export class DbStorageProvider implements StorageProvider {
  readonly name = "db";

  async save(fileName: string, data: Buffer, mime: string): Promise<string> {
    const key = `${UPLOAD_PREFIX}${fileName}`;
    await prisma.storedObject.upsert({
      where: { key },
      create: { key, mime, sizeBytes: data.length, data },
      update: { mime, sizeBytes: data.length, data },
    });
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    const row = await prisma.storedObject.findUnique({ where: { key } });
    if (!row) return null;
    return Buffer.from(row.data as Uint8Array);
  }

  async delete(key: string): Promise<void> {
    // Idempotent by contract: a missing key is a success, not an error.
    await prisma.storedObject.deleteMany({ where: { key } });
  }
}
