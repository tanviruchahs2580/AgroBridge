import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { StorageProvider } from "./types.js";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  constructor(private baseDir = path.resolve("uploads")) {}

  async save(fileName: string, data: Buffer): Promise<string> {
    const dir = path.join(this.baseDir, "disease");
    await mkdir(dir, { recursive: true });
    const full = path.join(dir, fileName);
    await writeFile(full, data);
    return `uploads/disease/${fileName}`;
  }

  async get(p: string): Promise<Buffer | null> {
    try {
      return await readFile(path.resolve(p));
    } catch {
      return null;
    }
  }
}
