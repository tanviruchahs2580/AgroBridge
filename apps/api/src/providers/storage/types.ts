export interface StorageProvider {
  readonly name: string;
  save(fileName: string, data: Buffer, mime: string): Promise<string>; // returns stored path/url
  get(path: string): Promise<Buffer | null>;
}

export type StorageConfig = {
  provider: "local" | "s3";
  localDir?: string;
  s3Bucket?: string;
  s3Region?: string;
};
