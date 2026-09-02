import { env } from "../../config/env.js";
import { LocalStorageProvider } from "./local.js";
import { S3StorageProvider } from "./s3.js";
import type { StorageProvider } from "./types.js";

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const isProd = env.NODE_ENV === "production";
  if (
    env.STORAGE_PROVIDER === "s3" &&
    env.S3_BUCKET &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY
  ) {
    cached = new S3StorageProvider(env.S3_BUCKET, env.S3_REGION ?? "auto", env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY, env.S3_ENDPOINT);
    return cached;
  }
  if (env.STORAGE_PROVIDER === "s3") {
    // Misconfigured s3 intent: fail-fast in prod, loud fallback in dev/test.
    if (isProd) throw new Error("STORAGE_PROVIDER=s3 misconfigured in production — startup should have aborted");
    console.error("STORAGE_PROVIDER=s3 but bucket/credentials missing — falling back to local disk");
    cached = new LocalStorageProvider();
    return cached;
  }
  cached = new LocalStorageProvider();
  return cached;
}
