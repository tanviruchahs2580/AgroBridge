import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { readSchemaState, resetSchemaStateCache } from "../src/infrastructure/schemaState.js";

/**
 * The schema readout is the release gate's evidence (deploy-verify compares the
 * latest applied migration), so its two subtle behaviours are pinned here: the
 * 60-second cache must not re-query on every readiness poll, and the test seam
 * must genuinely clear it. Previously the seam was exported and used by nothing.
 */
describe("schema state (D-03 / H-09)", () => {
  it("reports the applied chain truthfully and caches for 60 seconds", async () => {
    resetSchemaStateCache();
    const fresh = await readSchemaState();
    expect(fresh.known).toBe(true);
    expect(fresh.applied).toBeGreaterThan(0);

    // Independent cross-check of `latest`: the lexicographic max of the
    // finished migrations, read with a separate query.
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"
    );
    const expectedLatest = rows.map((r) => r.migration_name).sort().pop() ?? null;
    expect(fresh.latest).toBe(expectedLatest);
    expect(fresh.latest).toMatch(/^\d{14}_/);

    // Within the TTL the very same cached object is returned (no DB hit).
    const cached = await readSchemaState(Date.now() + 59_000);
    expect(cached).toBe(fresh);

    // The seam clears it: the next read builds a new value object.
    resetSchemaStateCache();
    const refreshed = await readSchemaState();
    expect(refreshed).not.toBe(fresh);
    expect(refreshed).toEqual(fresh);
  });
});
