import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { StorageProvider } from "./types.js";

/** Prefix every provider returns from `save` for disease uploads. */
const UPLOAD_PREFIX = "uploads/disease/";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  // Serverless runtimes (e.g. Vercel) expose only /tmp as writable — operators
  // set UPLOAD_BASE_DIR there; default keeps the repo-relative layout locally.
  constructor(private baseDir = path.resolve(env.UPLOAD_BASE_DIR ?? "uploads")) {}

  async save(fileName: string, data: Buffer): Promise<string> {
    const dir = path.join(this.baseDir, "disease");
    await mkdir(dir, { recursive: true });
    const full = path.join(dir, fileName);
    await writeFile(full, data);
    return `${UPLOAD_PREFIX}${fileName}`;
  }

  async get(p: string): Promise<Buffer | null> {
    try {
      return await readFile(path.resolve(p));
    } catch {
      return null;
    }
  }

  /**
   * Deletes a stored upload. Mirrors `save`: a key under the shared
   * `uploads/disease/` prefix resolves under `baseDir` (the directory `save`
   * actually wrote to), anything else is treated as a filesystem path the way
   * `get` treats it. Missing file (ENOENT) is a success — deletion is
   * idempotent by contract.
   */
  async delete(key: string): Promise<void> {
    const full = key.startsWith(UPLOAD_PREFIX)
      ? path.join(this.baseDir, "disease", path.basename(key.slice(UPLOAD_PREFIX.length)))
      : path.resolve(key);
    try {
      await unlink(full);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
  }
}
