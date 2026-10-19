import { describe, expect, it } from "vitest";
import { DbStorageProvider } from "../src/providers/storage/db.js";
import { LocalStorageProvider } from "../src/providers/storage/local.js";
import { storageReadiness } from "../src/providers/storage/index.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Durable uploads (AUD-165).
 *
 * Production ran the `local` provider over the serverless instance disk, so
 * every redeploy deleted uploaded photos. The `db` provider keeps the bytes in
 * the database; these tests pin the contract the release gate relies on.
 */
describe("db storage provider — durable uploads", () => {
  const provider = new DbStorageProvider();
  const freshName = () => `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
  const keys: string[] = [];
  const keyFor = (name: string) => {
    const k = `uploads/disease/${name}`;
    keys.push(k);
    return k;
  };

  it("round-trips bytes exactly and returns the storage key", async () => {
    const name = freshName();
    const key = keyFor(name);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 254, 255]);
    const returned = await provider.save(name, bytes, "image/jpeg");
    expect(returned).toBe(key);
    const back = await provider.get(key);
    expect(back).not.toBeNull();
    expect(Buffer.compare(back as Buffer, bytes)).toBe(0);
  });

  it("overwrites on re-save with the same key (upsert, not duplicate)", async () => {
    const name = freshName();
    const key = keyFor(name);
    await provider.save(name, Buffer.from("first"), "image/jpeg");
    await provider.save(name, Buffer.from("second"), "image/jpeg");
    const rows = await prisma.storedObject.count({ where: { key } });
    expect(rows).toBe(1);
    expect((await provider.get(key))?.toString()).toBe("second");
  });

  it("delete is idempotent: deleting a missing key succeeds", async () => {
    const name = freshName();
    const key = keyFor(name);
    await provider.save(name, Buffer.from("x"), "image/jpeg");
    await provider.delete(key);
    expect(await provider.get(key)).toBeNull();
    await expect(provider.delete(key)).resolves.toBeUndefined();
  });

  it("reports provider identity and durability for the release gate", () => {
    const state = storageReadiness();
    // Tests run with the default provider; the contract that matters is the
    // shape and the rule "local is the only non-durable provider".
    expect(["local", "db", "s3", "unconfigured"]).toContain(state.provider);
    expect(state.durable).toBe(state.provider === "db" || state.provider === "s3");
    // Both storage classes exist and expose the interface the factory switches on.
    expect(new LocalStorageProvider().name).toBe("local");
    expect(provider.name).toBe("db");
  });

  it("a stored object is readable after the module-level cache is irrelevant (durable across providers)", async () => {
    // Simulates "next instance": a fresh provider object reads what the first
    // one wrote — bytes live in the shared database, not process memory.
    const name = freshName();
    const key = keyFor(name);
    await provider.save(name, Buffer.from("durable"), "image/jpeg");
    const secondInstance = new DbStorageProvider();
    expect((await secondInstance.get(key))?.toString()).toBe("durable");
  });
});
