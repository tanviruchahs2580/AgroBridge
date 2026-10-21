/**
 * Shared resilience wrapper (ARC-09): timeout, bounded retry with jitter, and a
 * circuit breaker, applied to outbound provider calls (weather, AI, S3, SMS).
 *
 * Before this module each adapter implemented its own timeout — the behaviour
 * the audit (ARC-09, wave-1) flagged — and a failing provider was hit on every
 * request while it was down. The wrapper centralises:
 *
 *  - **timeout**: every attempt is a race against `timeoutMs` (an AbortSignal
 *    actually cancels the underlying fetch);
 *  - **bounded retry**: timeout/network errors are retried `retries` times with
 *    full-jitter backoff — never 4xx semantics (those are answers, not faults);
 *  - **circuit breaker**: after `threshold` consecutive failures the circuit
 *    opens for `openMs` and calls fail fast with `CIRCUIT_OPEN` instead of
 *    hammering a provider that is down; a half-open probe after `openMs` lets
 *    recovery happen without an operator.
 *
 * Deliberately unopinionated about the call itself: `fn` receives an
 * AbortSignal and returns a promise. No provider gets its own subclass.
 */

export interface ResilienceOptions {
  /** Per-attempt timeout in milliseconds (the attempt is aborted, not just abandoned). */
  timeoutMs: number;
  /** Retry count for timeout/network faults (NOT for thrown business errors). */
  retries?: number;
  /** Base backoff in ms for attempt n: full jitter over [0, base * 2^attempt]. */
  retryBaseMs?: number;
  /** Consecutive failures before the circuit opens. */
  threshold?: number;
  /** How long an open circuit stays open before allowing one probe. */
  openMs: number;
  /**
   * Distinguishes "fault worth retrying/breaking on" (network, timeout, 5xx)
   * from a business answer (4xx semantics) — the latter is returned as-is and
   * must not trip the breaker.
   */
  isFault?: (error: unknown) => boolean;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Injectable delay for tests (default: real setTimeout + jitter). */
  delay?: (ms: number) => Promise<void>;
}

export interface CallState {
  state: "closed" | "open" | "half-open";
  failures: number;
  openedAt: number | null;
}

export class CircuitOpenError extends Error {
  constructor(public readonly openForMs: number) {
    super(`circuit open (retry in ~${openForMs}ms)`);
    this.name = "CircuitOpenError";
  }
}

export interface Circuit {
  /** Snapshot for tests / a future metrics gauge. */
  state: CallState;
  /** True while the breaker refuses calls outright. */
  isOpen: (now?: number) => boolean;
  recordFailure: (now?: number) => void;
  recordSuccess: () => void;
}

const TYPED_FAULT_DEFAULT = (err: unknown): boolean => {
  const name = (err as { name?: string })?.name ?? "";
  const code = (err as { code?: string })?.code ?? "";
  return err instanceof CircuitOpenError || name === "AbortError" || name === "TimeoutError" || code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN" || code === "ENOTFOUND";
};

export function createCircuit(options: {
  threshold: number;
  openMs: number;
  now?: () => number;
}): Circuit {
  const now = options.now ?? Date.now;
  const state: CallState = { state: "closed", failures: 0, openedAt: null };
  return {
    state,
    isOpen(nowOverride?: number) {
      if (state.state !== "open") return false;
      const t = nowOverride ?? now();
      if (t - (state.openedAt ?? 0) >= options.openMs) {
        state.state = "half-open"; // one probe passes; failures re-open
        return false;
      }
      return true;
    },
    recordFailure(nowOverride?: number) {
      state.failures++;
      if (state.failures >= options.threshold) {
        state.state = "open";
        state.openedAt = nowOverride ?? now();
      }
    },
    recordSuccess() {
      state.failures = 0;
      state.state = "closed";
      state.openedAt = null;
    },
  };
}

export function withResilience<Result>(
  circuit: Circuit,
  options: ResilienceOptions,
  fn: (signal: AbortSignal, attempt: number) => Promise<Result>,
): () => Promise<Result> {
  const now = options.now ?? Date.now;
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const isFault = options.isFault ?? TYPED_FAULT_DEFAULT;
  const retries = options.retries ?? 1;
  const base = options.retryBaseMs ?? 300;

  return async (): Promise<Result> => {
    if (circuit.isOpen(now())) {
      throw new CircuitOpenError(options.openMs);
    }

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const result = await fn(controller.signal, attempt);
        circuit.recordSuccess();
        return result;
      } catch (err) {
        if (!isFault(err)) {
          circuit.recordSuccess();
          throw err; // a business answer, not an infrastructure fault
        }
        circuit.recordFailure();
        if (attempt >= retries) throw err;
        // Full-jitter backoff; if the breaker opened while backing off, refuse now.
        await delay(base * 2 ** attempt * Math.random());
        if (circuit.isOpen(now())) throw new CircuitOpenError(options.openMs);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
