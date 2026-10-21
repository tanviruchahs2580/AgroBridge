import { afterEach, describe, expect, it, vi } from "vitest";
import { DbStorageProvider } from "../src/providers/storage/db.js";
import { getStorageProvider } from "../src/providers/storage/index.js";
import { removeStoredUpload } from "../src/providers/storage/cleanup.js";
import { drainPendingPurges } from "../src/providers/storage/purgeQueue.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Retryable upload purges (honesty + retryability of account deletion):
 * a failed purge is queued instead of vanishing into a log line, and the queue
 * drains with idempotent provider deletes.
 */
describe("upload purge queue", () => {
  const provider = new DbStorageProvider();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queues a failed purge and reports failure instead of silent success", async () => {
    const key = `uploads/disease/purge-${Date.now()}.jpg`;
    await provider.save(key.split("/").pop()!, Buffer.from("x"), "image/jpeg");

    // The provider factory caches one instance; make its delete fail for this call.
    vi.spyOn(getStorageProvider(), "delete").mockRejectedValueOnce(new Error("storage unreachable"));
    const removed = await removeStoredUpload(key, "unit-test:deletion");
    expect(removed).toBe(false);

    const queued = await prisma.pendingUploadPurge.findFirst({ where: { key } });
    expect(queued).not.toBeNull();
    expect(queued!.attempts).toBe(1);
    expect(queued!.lastError).toContain("storage unreachable");
  });

  it("drains the queue with idempotent deletes", async () => {
    const key = `uploads/disease/purge-${Date.now()}-drain.jpg`;
    // Store through the ACTIVE provider (local in tests) so the drain's delete
    // path is the one that actually removed the bytes.
    await getStorageProvider().save(key.split("/").pop()!, Buffer.from("y"), "image/jpeg");
    await prisma.pendingUploadPurge.create({ data: { key, context: "unit-test:drain", attempts: 1 } });

    const result = await drainPendingPurges(50);
    expect(result.drained).toBeGreaterThanOrEqual(1);
    expect(await prisma.pendingUploadPurge.findFirst({ where: { key } })).toBeNull();
    expect(await getStorageProvider().get(key)).toBeNull();
  });

  it("keeps retrying rows whose delete keeps failing, counting attempts", async () => {
    const key = `uploads/disease/purge-${Date.now()}-stuck.jpg`;
    await prisma.pendingUploadPurge.create({ data: { key, context: "unit-test:stuck", attempts: 1 } });

    vi.spyOn(getStorageProvider(), "delete").mockRejectedValue(new Error("still down"));
    const result = await drainPendingPurges(50);
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const stillQueued = await prisma.pendingUploadPurge.findFirst({ where: { key } });
    expect(stillQueued).not.toBeNull();
    expect(stillQueued!.attempts).toBe(2);
    expect(stillQueued!.lastError).toContain("still down");

    // Cleanup so later runs do not inherit the row.
    await prisma.pendingUploadPurge.deleteMany({ where: { key } });
  });
});
