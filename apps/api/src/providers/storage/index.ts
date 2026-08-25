import { env } from "../../config/env.js";
import { LocalStorageProvider } from "./local.js";
import type { StorageProvider } from "./types.js";

export function getStorageProvider(): StorageProvider {
  // Future: if STORAGE_PROVIDER === "s3" and creds present, return S3 provider (see docs)
  if (env.STORAGE_PROVIDER === "s3") {
    // Placeholder: would return S3StorageProvider here — requires S3_BUCKET etc.
    return new LocalStorageProvider();
  }
  return new LocalStorageProvider();
}
