export interface StorageProvider {
  readonly name: string;
  save(fileName: string, data: Buffer, mime: string): Promise<string>; // returns stored path/url
  get(path: string): Promise<Buffer | null>;
  /**
   * Removes a previously saved object by the same key `save` returned
   * (`uploads/disease/<fileName>`). Must be idempotent: deleting an object
   * that is already gone is a success, not an error.
   */
  delete(key: string): Promise<void>;
}

export type StorageConfig = {
  provider: "local" | "s3" | "db";
  localDir?: string;
  s3Bucket?: string;
  s3Region?: string;
};
