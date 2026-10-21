import { logger } from "../../lib/logger.js";
import { getStorageProvider } from "./index.js";
import { enqueuePendingPurge } from "./purgeQueue.js";

/**
 * Best-effort removal of one stored upload ( account deletion,
 * orphaned-upload cleanup).
 *
 * Cleanup happens on paths where the primary operation must NOT fail because
 * storage could not be reached (account deletion still succeeds; the upload
 * error is still reported to the client). This helper therefore never throws:
 * a failed delete is logged, queued for retry (purgeQueue) and reported as
 * `false` so the caller can count and surface it. Documented in
 * docs/data-protection.md.
 */
export async function removeStoredUpload(key: string, context: string): Promise<boolean> {
  try {
    await getStorageProvider().delete(key);
    return true;
  } catch (e) {
    const message = (e as Error).message;
    logger.warn({ key, context, err: message }, "stored upload cleanup failed — queued for retry");
    await enqueuePendingPurge(key, context, message);
    return false;
  }
}
