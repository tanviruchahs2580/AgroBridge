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

  async save(fileName: string, data: Buffer, _mime: string): Promise<string> {
    // `_mime`: the interface's third parameter is honored by object stores
    // (S3 sets the Content-Type); a filesystem has nowhere to put it — the
    // extension derived from the declared MIME at call time carries the type.
    const dir = path.join(this.baseDir, "disease");
    await mkdir(dir, { recursive: true });
    const full = path.join(dir, fileName);
    await writeFile(full, data);
    return `${UPLOAD_PREFIX}${fileName}`;
  }

  /**
   * Reads a stored object. `save` writes under `baseDir` (operators relocate it
   * via UPLOAD_BASE_DIR on serverless runtimes) and returns the relative key
   * `uploads/disease/<name>`; resolving that key with `path.resolve` against the
   * working directory — as this method used to — pointed at the wrong place
   * whenever a base dir was configured, so every read of an existing upload
   * returned null (AUD-207). The key is resolved through `baseDir` exactly like
   * `delete` does; keys outside the shared prefix remain plain filesystem paths.
   */
  async get(p: string): Promise<Buffer | null> {
    const full = p.startsWith(UPLOAD_PREFIX)
      ? path.join(this.baseDir, "disease", path.basename(p.slice(UPLOAD_PREFIX.length)))
      : path.resolve(p);
    try {
      return await readFile(full);
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
