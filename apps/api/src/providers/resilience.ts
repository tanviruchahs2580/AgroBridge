/**
 * Shared outbound-call policy for provider adapters (weather, AI, SMS, S3).
 *
 * Every remote call runs through one place that guarantees four bounded
 * behaviours, so adapters do not each re-invent — or forget — them:
 *
 *  - a per-attempt timeout (`AbortSignal.timeout`), so a hung socket can never
 *    pin a request slot forever;
 *  - bounded retries with FULL jitter, only for failures a repeat can fix
 *    (5xx / 429 / network / timeout) — never for a final 4xx;
 *  - an in-process circuit breaker per provider name: consecutive failed calls
 *    open the circuit, one half-open probe after a cooldown tests recovery,
 *    and any success closes it again. While open, calls fail fast instead of
 *    queueing behind a dependency that is already down;
 *  - a concurrency bulkhead: more than `maxConcurrent` in-flight calls for one
 *    provider fail fast with a typed error instead of piling up.
 *
 * Error transparency: a failed call rethrows the LAST attempt's error object
 * unchanged, so a provider's typed error keeps its code, status and message
 * (the AI adapter's `AiProviderError` taxonomy survives the wrapper). Only
 * policy refusals — open circuit, full bulkhead — raise `ResilienceError`, so
 * a caller can always tell "the provider said no" from "we never called it".
 *
 * Offline/mock adapters are deliberately NOT wired through this policy: there
 * is no network to protect, and a breaker would turn deterministic local
 * behaviour into flopping failure modes.
 */

export type ResilienceState = "closed" | "open" | "half-open";

export type ResilienceErrorCode = "CIRCUIT_OPEN" | "BULKHEAD_FULL";

/** The call was refused by policy, before any outbound request was made. */
export class ResilienceError extends Error {
  constructor(
    public readonly code: ResilienceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ResilienceError";
  }
}

/**
 * An HTTP response classified as a failure, carrying its status so the shared
 * retry policy can decide (5xx/429 retryable, other 4xx final) without every
 * adapter re-implementing that branch.
 */
export class UpstreamHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "UpstreamHttpError";
  }
}

export interface ResilienceOptions {
  /** Per-attempt timeout in milliseconds. Default 10s. */
  timeoutMs?: number;
  /** Attempts AFTER the first. Default 1 (at most two outbound calls). */
  retries?: number;
  /** Retry-delay ceiling in ms; the actual delay is uniform in [0, ceiling]. */
  retryDelayMs?: number;
  /** Consecutive failed calls that open the circuit. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before one half-open probe. Default 30s. */
  cooldownMs?: number;
  /** Max in-flight calls for this provider; extra calls fail fast. Unset = unlimited. */
  maxConcurrent?: number;
  /**
   * Overrides the retry classification. Transports whose failure taxonomy is
   * stricter than the default (e.g. the AI adapter never retries a timeout)
   * pass their own predicate.
   */
  isRetryable?: (err: unknown) => boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 300;
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000;

interface ProviderBookkeeping {
  state: ResilienceState;
  consecutiveFailures: number;
  openedAt: number | null;
  inFlight: number;
  /** Sticky per provider: the bulkhead limit must be shared by every caller. */
  maxConcurrent: number | undefined;
  /** True while the single half-open probe is in flight. */
  probing: boolean;
}

const providers = new Map<string, ProviderBookkeeping>();

function bookkeepingFor(name: string): ProviderBookkeeping {
  let entry = providers.get(name);
  if (!entry) {
    entry = { state: "closed", consecutiveFailures: 0, openedAt: null, inFlight: 0, maxConcurrent: undefined, probing: false };
    providers.set(name, entry);
  }
  return entry;
}

/** Node socket/DNS failure codes that a retry can genuinely fix. */
const NETWORK_ERROR_CODES = /^(ECONN|EAI_|UND_ERR|ETIMEDOUT|EPIPE|ENET|EHOST|ERR_SOCKET)/;

/**
 * Default retry classification:
 *  1. an error that declares its own `retryable` boolean wins (the AI
 *     adapter's typed errors pin their policy this way);
 *  2. an HTTP status retries on 429/5xx only;
 *  3. timeouts (AbortSignal.timeout → TimeoutError; fetch may surface
 *     AbortError) and socket-level network failures retry;
 *  4. anything else is final — a retry cannot fix a logic error.
 */
export function defaultIsRetryable(err: unknown): boolean {
  const declared = (err as { retryable?: unknown } | null)?.retryable;
  if (typeof declared === "boolean") return declared;
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && NETWORK_ERROR_CODES.test(code)) return true;
  // Undici reports DNS/socket failures as TypeError("fetch failed").
  if (err instanceof TypeError) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One attempt: the caller's fn gets a fresh timeout signal; the wrapper never trusts it to honour it. */
async function attemptOnce<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs);
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([fn(signal), timeout]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function attemptWithRetries<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  cfg: { retries: number; retryDelayMs: number; timeoutMs: number; isRetryable: (err: unknown) => boolean },
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await attemptOnce(fn, cfg.timeoutMs);
    } catch (err) {
      if (attempt >= cfg.retries || !cfg.isRetryable(err)) throw err;
      attempt++;
      // Full jitter: uniform in [0, ceiling]. No backoff schedule to tune per
      // provider, and the jitter keeps parallel callers from retrying in sync.
      const delay = Math.floor(Math.random() * cfg.retryDelayMs);
      if (delay > 0) await sleep(delay);
    }
  }
}

/** Circuit + bulkhead admission gate. Runs before any outbound call is made. */
function admit(name: string, st: ProviderBookkeeping, cooldownMs: number): void {
  if (st.state === "open") {
    if (st.openedAt !== null && Date.now() - st.openedAt >= cooldownMs) {
      st.state = "half-open";
      st.probing = false;
    } else {
      throw new ResilienceError(
        "CIRCUIT_OPEN",
        `${name}: circuit open after ${st.consecutiveFailures} consecutive failures — failing fast`,
      );
    }
  }
  if (st.state === "half-open" && st.probing) {
    throw new ResilienceError("CIRCUIT_OPEN", `${name}: circuit half-open — a probe is already in flight`);
  }
  if (st.maxConcurrent !== undefined && st.inFlight >= st.maxConcurrent) {
    throw new ResilienceError(
      "BULKHEAD_FULL",
      `${name}: bulkhead full (${st.inFlight}/${st.maxConcurrent} in flight) — failing fast`,
    );
  }
  if (st.state === "half-open") st.probing = true;
}

function recordSuccess(st: ProviderBookkeeping): void {
  st.state = "closed";
  st.consecutiveFailures = 0;
  st.openedAt = null;
  st.probing = false;
}

function recordFailure(st: ProviderBookkeeping, threshold: number): void {
  st.probing = false;
  st.consecutiveFailures++;
  // A failed half-open probe re-opens immediately with a fresh cooldown; a
  // closed circuit opens once the consecutive-failure threshold is reached.
  if (st.state === "half-open" || st.consecutiveFailures >= threshold) {
    st.state = "open";
    st.openedAt = Date.now();
  }
}

/**
 * Runs `fn` under the shared policy for the provider `name`. `fn` receives the
 * per-attempt abort signal and must pass it to its transport (fetch), so a
 * timed-out attempt actually releases the socket.
 */
export async function withResilience<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: ResilienceOptions = {},
): Promise<T> {
  const st = bookkeepingFor(name);
  const threshold = opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  if (opts.maxConcurrent !== undefined) st.maxConcurrent = opts.maxConcurrent;

  admit(name, st, cooldownMs);
  st.inFlight++;
  try {
    const value = await attemptWithRetries(fn, {
      retries: opts.retries ?? DEFAULT_RETRIES,
      retryDelayMs: opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      isRetryable: opts.isRetryable ?? defaultIsRetryable,
    });
    recordSuccess(st);
    return value;
  } catch (err) {
    recordFailure(st, threshold);
    throw err;
  } finally {
    st.inFlight--;
  }
}

/**
 * Per-provider breaker snapshot — the hook for /ready or metrics wiring.
 * Counters are process-local by design: each instance runs its own breaker,
 * exactly like the in-memory rate-limit store (docs/security.md).
 */
export function resilienceState(): Record<string, { state: ResilienceState; consecutiveFailures: number; openedAt: number | null }> {
  const out: Record<string, { state: ResilienceState; consecutiveFailures: number; openedAt: number | null }> = {};
  for (const [name, st] of providers) {
    out[name] = { state: st.state, consecutiveFailures: st.consecutiveFailures, openedAt: st.openedAt };
  }
  return out;
}

/**
 * Clears breaker/bulkhead bookkeeping so a fresh scenario starts from a known
 * state. In-flight calls are not touched; call it only when the named provider
 * is idle (tests do; operations would use it after an incident review).
 */
export function resetResilience(name?: string): void {
  if (name === undefined) providers.clear();
  else providers.delete(name);
}
