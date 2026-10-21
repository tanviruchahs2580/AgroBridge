import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { cpus } from "node:os";
import { env, isTest } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

/**
 * Password hashing off the event loop (F-02 / F-11 from the 10k-concurrency audit).
 *
 * Measured before this existed: 100 simultaneous logins pinned exactly one core
 * at cost 12 for 77 seconds (p50 46 s), and during that window an unrelated
 * `GET /health` waited up to 74 s. bcryptjs is pure JavaScript, so every
 * comparison runs on the main thread; the instance's ability to answer anything
 * else is spent on password verification.
 *
 * This pool runs the same bcryptjs library (never a different implementation —
 * hash compatibility is a data-format contract, not an implementation detail) in
 * a small set of worker threads:
 *
 *  - the main thread only marshals strings, so a login burst can no longer stall
 *    unrelated requests;
 *  - the work spreads across cores, which a single-threaded event loop cannot do;
 *  - the module-load `bcrypt.hashSync(..., 12)` that used to block process
 *    startup now happens inside a worker, off the startup path (F-11).
 *
 * Failure policy: if a worker cannot start, exits, or errors mid-request, the
 * affected calls are re-run **in-thread with the identical bcryptjs code** and
 * the pool retires itself. The worst case is therefore exactly the behaviour
 * that shipped before this file existed — a performance regression is allowed,
 * a login outage is not.
 */

/**
 * The worker body. Written as a string and started with `eval: true` because it
 * has to load unchanged from four different execution contexts — `tsx` in dev, the
 * `tsc` output in the container, Vercel's traced serverless bundle, and Vitest —
 * and a helper file that any one of them fails to ship would break login. Only
 * `bcryptjs` is resolved by path (passed in `workerData`), never by a relative
 * import, so no bundler can rewrite it out from under us.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const mod = await import(workerData.bcryptUrl);
  const bcrypt = mod.default ?? mod;

  // B-05 timing equalisation, now off the main thread: the unknown-phone path
  // compares against this dummy hash at the same cost as a real one, so both
  // paths spend the same work. Computed lazily and asynchronously so it never
  // delays the first real comparison (F-11).
  let dummy = null;
  const getDummy = () => (dummy ??= bcrypt.hash(workerData.dummySource, workerData.cost));

  parentPort.postMessage({ type: 'ready' });

  parentPort.on('message', async (msg) => {
    try {
      if (msg.kind === 'compare') {
        const known = msg.hash !== null;
        const matches = await bcrypt.compare(msg.password, known ? msg.hash : await getDummy());
        // A null hash means "no such account" — false regardless of the dummy
        // comparison's outcome, exactly like verifyPasswordAgainst did inline.
        // The dummy flag is reported so the B-05 timing-equalisation spec can
        // still assert, structurally, that the comparison really happened (it can
        // no longer spy on bcrypt.compare: that call is in this thread, not the
        // test's). No backticks in this comment: it lives inside a template literal.
        parentPort.postMessage({ id: msg.id, result: known ? matches : false, dummy: !known });
      } else {
        parentPort.postMessage({ id: msg.id, result: await bcrypt.hash(msg.password, msg.cost) });
      }
    } catch (e) {
      parentPort.postMessage({ id: msg.id, error: String((e && e.message) || e) });
    }
  });
})();
`;

/** Same source string the inline helper used, so timing equalisation is unchanged. */
const DUMMY_PASSWORD_SOURCE = "agrobridge-dummy-password-timing-equalizer";

/** Production cost factor; the test profile hashes at 4 for speed (unchanged rule). */
const COST = isTest ? 4 : 12;

/**
 * The factor every hash this process writes is and was produced at — the single
 * place that knows it. Login compares a stored hash's own embedded cost against
 * this value to decide whether to upgrade it transparently (F-02 option c): if an
 * operator ever lowers the factor under load, accounts heal back to the higher
 * cost as their owners return, instead of the weakening becoming permanent.
 */
export function bcryptCost(): number {
  return COST;
}

interface Job {
  id: number;
  kind: "hash" | "compare";
  password: string;
  hash?: string | null;
  cost?: number;
  worker: Worker | null;
  resolve: (value: string | boolean) => void;
  reject: (err: Error) => void;
}

/**
 * Counters so a test (or a future metrics scrape) can prove which path ran —
 * including which comparisons were made against the dummy hash, which is the
 * observable form of the B-05 timing-equalisation guarantee now that the
 * comparison happens in a worker rather than on the caller's thread.
 */
const counters = { pooled: 0, fallback: 0, workerFailures: 0, dummyComparisons: 0 };

export function bcryptPoolStats() {
  // `cost` is the factor both real and dummy comparisons use; exposing it lets a
  // spec assert the two are equal by construction instead of by stopwatch.
  return { ...counters, size: workers.length, unavailable, started, cost: COST };
}

let workers: Worker[] = [];
let started = false;
let unavailable = false;
let next = 0;
let seq = 0;
const pending = new Map<number, Job>();

/** Lazily imported so an in-thread fallback costs nothing until it is needed. */
let inlineBcrypt: Promise<typeof import("bcryptjs")> | null = null;
function bcryptInline() {
  return (inlineBcrypt ??= import("bcryptjs"));
}

function poolSize(): number {
  if (env.BCRYPT_POOL_SIZE !== undefined) return env.BCRYPT_POOL_SIZE;
  // One worker per core would fight the event loop for CPU; a small pool lifts
  // login throughput several-fold without starving request handling.
  return Math.max(1, Math.min(4, cpus().length - 1));
}

/**
 * Starts the pool once. Returns false when hashing must stay on the main thread.
 * Never throws: every failure mode degrades to the inline implementation.
 */
function ensurePool(): boolean {
  if (started) return workers.length > 0;
  started = true;

  const size = poolSize();
  if (size <= 0) {
    logger.warn("BCRYPT_POOL_SIZE=0 — password hashing stays on the event loop (F-02 mitigation disabled)");
    unavailable = true;
    return false;
  }

  try {
    const bcryptUrl = pathToFileURL(createRequire(import.meta.url).resolve("bcryptjs")).href;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { bcryptUrl, cost: COST, dummySource: DUMMY_PASSWORD_SOURCE },
      });
      // Must not hold the process (or a test run) open; a job in flight always
      // has a live request behind it keeping the loop alive.
      worker.unref();
      worker.on("message", (msg: { id?: number; result?: unknown; error?: string }) => onWorkerMessage(worker, msg));
      worker.on("error", (err) => retireWorker(worker, err));
      worker.on("exit", (code) => {
        if (code !== 0) retireWorker(worker, new Error(`bcrypt worker exited with code ${code}`));
      });
      workers.push(worker);
    }
    logger.info({ workers: size, cost: COST }, "bcrypt worker pool started");
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "bcrypt worker pool unavailable — hashing on the event loop");
    retireAll();
    return false;
  }
  return workers.length > 0;
}

/** Marks the pool dead and finishes every job it was holding on the main thread. */
function retireAll(): void {
  unavailable = true;
  const orphaned = [...pending.values()];
  pending.clear();
  workers = [];
  for (const job of orphaned) void runInline(job);
}

function retireWorker(worker: Worker, err: Error): void {
  counters.workerFailures++;
  logger.warn({ err: err.message }, "bcrypt worker failed — finishing its jobs in-thread");
  workers = workers.filter((w) => w !== worker);
  if (!workers.length) unavailable = true;

  const orphaned = [...pending.values()].filter((job) => job.worker === worker);
  for (const job of orphaned) {
    pending.delete(job.id);
    void runInline(job);
  }
}

function onWorkerMessage(worker: Worker, msg: { id?: number; result?: unknown; error?: string; dummy?: boolean }): void {
  if (msg?.id === undefined) return; // 'ready' notification
  const job = pending.get(msg.id);
  if (!job) return;
  pending.delete(msg.id);
  if (msg.dummy) counters.dummyComparisons++;
  if (msg.error !== undefined) {
    // A library-level failure (e.g. a malformed stored hash) is a real answer,
    // not an infrastructure problem: finish in-thread so the caller sees the
    // same outcome the inline implementation would have produced.
    void runInline(job, msg.error);
    return;
  }
  counters.pooled++;
  job.resolve(msg.result as string | boolean);
}

/** The pre-existing implementation, used only when the pool cannot serve a job. */
async function runInline(job: Job, previousError?: string): Promise<void> {
  try {
    // `@types/bcryptjs` declares named exports only, while the package itself is
    // CommonJS — dynamic import therefore yields the namespace with the real
    // functions copied onto it (Node interop) or under `default` depending on the
    // resolver. Accept both rather than betting on one.
    const mod = (await bcryptInline()) as unknown as { default?: typeof import("bcryptjs") } & typeof import("bcryptjs");
    const bcrypt = mod.default ?? mod;
    counters.fallback++;
    if (job.kind === "compare") {
      const known = job.hash !== null && job.hash !== undefined;
      const matches = await bcrypt.compare(job.password, known ? (job.hash as string) : bcrypt.hashSync(DUMMY_PASSWORD_SOURCE, COST));
      job.resolve(known ? matches : false);
    } else {
      job.resolve(await bcrypt.hash(job.password, job.cost ?? COST));
    }
  } catch (e) {
    job.reject(e instanceof Error ? e : new Error(previousError ?? String(e)));
  }
}

function submit(job: Omit<Job, "id" | "worker" | "resolve" | "reject">): Promise<string | boolean> {
  return new Promise<string | boolean>((resolve, reject) => {
    const id = ++seq;
    const full: Job = { ...job, id, worker: null, resolve, reject };

    if (!ensurePool() || !workers.length) {
      void runInline(full);
      return;
    }

    const worker = workers[next++ % workers.length];
    full.worker = worker;
    pending.set(id, full);
    worker.postMessage(
      full.kind === "compare"
        ? { id, kind: "compare", password: full.password, hash: full.hash ?? null }
        : { id, kind: "hash", password: full.password, cost: full.cost ?? COST },
    );
  });
}

/** bcrypt hash (cost 12 in production, 4 under test) — off the event loop. */
export function bcryptHash(password: string, cost?: number): Promise<string> {
  return submit({ kind: "hash", password, cost }) as Promise<string>;
}

/** bcrypt compare against `hash`, or against the dummy hash when `hash` is null. */
export function bcryptCompare(password: string, hash: string | null): Promise<boolean> {
  return submit({ kind: "compare", password, hash }) as Promise<boolean>;
}

/** Test seam: stop the pool and forget every counter so specs start clean. */
export async function shutdownBcryptPool(): Promise<void> {
  const all = workers;
  workers = [];
  pending.clear();
  started = false;
  unavailable = false;
  counters.pooled = 0;
  counters.fallback = 0;
  counters.workerFailures = 0;
  counters.dummyComparisons = 0;
  await Promise.all(all.map((w) => w.terminate().catch(() => undefined)));
}
