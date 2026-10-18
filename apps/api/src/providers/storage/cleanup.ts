import { logger } from "../../lib/logger.js";
import { getStorageProvider } from "./index.js";

/**
 * Best-effort removal of one stored upload (B-24 account deletion, B-17
 * orphaned-upload cleanup).
 *
 * Cleanup happens on paths where the primary operation must NOT fail because
 * storage could not be reached (account deletion still succeeds; the upload
 * error is still reported to the client). This helper therefore never throws:
 * it logs a warning with the key and context and returns false so the caller
 * can count failures. Documented in docs/data-protection.md.
 */
export async function removeStoredUpload(key: string, context: string): Promise<boolean> {
  try {
    await getStorageProvider().delete(key);
    return true;
  } catch (e) {
    logger.warn({ key, context, err: (e as Error).message }, "stored upload cleanup failed");
    return false;
  }
}
