# ADR-0012: Durable uploads in the database (`db` storage provider)

- **Status:** accepted (2026-10-19)
- **Deciders:** engineering (audit remediation); production env change is an operator action
- **Supersedes:** nothing. Extends ADR-0005 (provider adapters) and ADR-0004 (dialect strategy)

## Context

Disease-photo uploads were stored through the `local` storage provider. On the
serverless production runtime there is no persistent disk, so the operator
runbook pointed `UPLOAD_BASE_DIR` at `/tmp`: every redeploy (or cold instance)
silently discarded user content, while all CI gates stayed green. The provider
itself documented the consequence (`env.ts` placeholder manifest: "lost on
redeploy") and boot required the explicit `ALLOW_PLACEHOLDER_PROVIDERS=1`
acknowledgement, but nothing made durability a release property — the same class
of gap ADR-0007 closed for the schema.

The `s3` adapter exists and remains the target for object storage at higher
volumes, but activating it needs provider credentials/buckets that the owner has
not provisioned yet. The failure mode (irrecoverable user content) is severe
enough that it must not wait on that provisioning.

## Decision

1. Add a third storage provider, `db`, that stores object bytes in the database
   (`StoredObject` table: key, mime, sizeBytes, data). It needs no external
   service; it rides the database that is already backed up.
2. `STORAGE_PROVIDER=db` is the production recommendation until object storage
   is provisioned.
3. `/ready` reports `storage: { provider, durable }`, and `deploy-verify.yml`
   fails the release when production reports a non-durable provider (`local`).
   This mirrors the schema gate: the property is enforced, and the failure
   message tells the operator exactly which env value to set.
4. Existing `local` behaviour is unchanged for development and tests; no
   production boot-break is introduced by this change alone (the gate, not a
   crash, drives the cutover).

## Consequences

- Uploads survive redeploys without new infrastructure; the audit's S1 finding
  (data loss) closes when the operator sets `STORAGE_PROVIDER=db`.
- Database size grows with uploaded bytes (8 MB request cap, JPEG metadata
  stripped before storage). Acceptable at pilot volume; revisit when the audit
  target architecture's object storage is provisioned (`s3` provider, signed
  URLs), and record the switch here.
- Backups now cover uploads as a side effect — the retention/PITR story for
  images is the database's story (ADR-0011, docs/disaster-recovery.md).
- Tests: provider contract tests (`tests/storage-db-provider.test.ts`) pin
  round-trip fidelity and idempotent deletion for both dialects.
