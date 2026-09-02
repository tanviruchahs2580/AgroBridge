# Phase 2 — Backend Type Safety Transformation (Inventory, No Flip)

**Status:** INVENTORY ONLY — `strict:false` retained per prohibition #5 (must be staged). No commit, no push.
**Baseline:** `apps/api/tsconfig.json:10` `strict:false`, `tsconfig.build.json:6-7` `noImplicitAny:false, strict:false`

## 1. Inventory — Exact Counts (2026-09-02, `rg` verified)

| Pattern | Count | Primary Files |
|---|---:|---|
| `as never` | 14 | `farms/routes.ts:79,127,151,274`, `services/routes.ts:43,59`, `marketplace/routes.ts:76`, `payments/routes.ts:42,47,59,157`, `webhook.ts:56`, `admin/routes.ts:103`, `disease.ts:144` |
| `req.auth!` | 122 | every `src/modules/*` (e.g. `services/routes.ts:84,102,114,133,226`, `farms/routes.ts:39-89`, `payments/routes.ts:81+`) |
| `req.params.*!` | 33 | `organizations/routes.ts:56,76,94,100,109`, `admin/routes.ts:102,182,186,207,211,215,219`, `farms/routes.ts:89,103,135,148`, `payments/routes.ts:146,203`, etc. |
| `req.query as unknown as` | 3 | `admin/routes.ts:66`, `marketplace/routes.ts:44`, `weather/routes.ts:16` |
| `Record<string,unknown>` where | 3 | `farms/routes.ts:44`, `procurement/routes.ts:91-99`, `services/routes.ts:183-192` |

## 2. Staged Rollout (never one commit)

### Stage A — `noImplicitAny: true` (next)
- **Scope:** Only implicit-any sites. Most are in tests today (`journey-farm.test.ts:56` `userId`, `wallet-withdrawals.test.ts:101` `balanceAfterPaisa`) — not prod, but must be typed.
- **Acceptance:** `tsc --noEmit -p tsconfig.json` with `noImplicitAny:true` shows ≤5 errors, all fixed with explicit types, no `any` added. `vitest run` green.
- **Files to touch:** `apps/api/tsconfig.json:10` staged override + 2 test files. No API `src/` logic change in Stage A.

### Stage B — `strictNullChecks: true` (largest)
- **Surfaces:** 122 `req.auth!` → introduce `AuthenticatedRequest` interface from `authenticate()` middleware (`middleware/auth.ts:19-39`) so `req.auth` is non-optional on authed routes; 33 `params!` → Zod-validated `req.params` via `validate({params:schema})` (`middleware/validate.ts:7`); `req.query` casts replaced by `validate({query:schema})`.
- **Files:** `auth.ts:12-34` (new `AuthenticatedRequest`), every `modules/*/routes.ts` (≈12 files). One file at a time, each with characterization test before/after.
- **Acceptance:** Zero `!` on request data, `vitest run` + `vitest --config pg` green.

### Stage C — `noUncheckedIndexedAccess: true`
- **Surfaces:** `array[i]` and `record[key]` sites (e.g. `procurement/routes.ts:95` region filter, `services/routes.ts:191` scope). Add bounds checks.
- **Files:** 3–5 files.

### Stage D — `exactOptionalPropertyTypes: true`
- **Surfaces:** `Prisma.*CreateInput` optional vs `undefined` (all `as never` sites currently hide this).

### Stage E — `strict: true`
- Only after A–D clean, flip `strict:true` in both `tsconfig.json:10` and `tsconfig.build.json:6`. Zero suppressions.

## 3. `as never` Retirement — One at a Time (example: `payments/routes.ts:42`)
```ts
// before (unsafe)
await prisma.payment.create({ data: { ... } as never })
// after (explicit)
import type { Prisma } from "@prisma/client";
const data: Prisma.PaymentCreateInput = { amountPaisa, purposeType, ... };
await prisma.payment.create({ data });
```
Run `vitest run` + PG integration per retirement. Never batch.

## 4. UI/UX Impact
**none** — all changes are `apps/api` internals. Per contract, `apps/web/dist` byte-identical re-run required after any shared-type change — will re-run `vite build` + `visual-contract` baselines; non-zero diff blocks merge.

## 5. Risk if Left Unaddressed (per audit §2.7)
Schema rename would compile silently via `as never` and fail at runtime; `req.auth!` crash if `requireAuth` ordering changes; `Record<string,unknown>` filters pass misspelled relation names.

## 6. Next (requires branch/PR — blocked per no-push)
Open branch `chore/type-stageA-noImplicitAny`, fix 2 test files, CI green, merge — then Stage B file-by-file.
