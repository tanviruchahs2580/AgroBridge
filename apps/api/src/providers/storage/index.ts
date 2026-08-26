import { env } from "../../config/env.js";
import { LocalStorageProvider } from "./local.js";
import { S3StorageProvider } from "./s3.js";
import type { StorageProvider } from "./types.js";

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  cached =
    env.STORAGE_PROVIDER === "s3" &&
    env.S3_BUCKET &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY
      ? new S3StorageProvider(env.S3_BUCKET, env.S3_REGION ?? "auto", env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY, env.S3_ENDPOINT)
      : // Misconfigured s3 intent falls back LOUDLY, never silently.
        env.STORAGE_PROVIDER === "s3"
        ? (() => {
            console.error("STORAGE_PROVIDER=s3 but bucket/credentials missing — falling back to local disk");
            return new LocalStorageProvider();
          })()
        : new LocalStorageProvider();
  return cached;
}
