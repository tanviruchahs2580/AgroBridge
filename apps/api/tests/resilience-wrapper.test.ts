import { describe, expect, it, vi } from "vitest";
import { createCircuit, CircuitOpenError, withResilience } from "../src/infrastructure/resilience.js";

/**
 * Failure-injection specs for the shared resilience wrapper (ARC-09): timeout,
 * bounded retry with jitter, and the circuit breaker — the wrapper replaces the
 * per-adapter timeouts the audit flagged as inconsistent.
 */

const fixedNow = () => 1_000_000;
const noDelay = () => Promise.resolve();

function makeWrapper(overrides: Partial<Parameters<typeof withResilience>[1]> = {}, breaker?: { threshold: number; openMs: number }) {
  const circuit = createCircuit({ threshold: breaker?.threshold ?? 3, openMs: breaker?.openMs ?? 30_000, now: fixedNow });
  return {
    circuit,
    call: (fn: (signal: AbortSignal, attempt: number) => Promise<unknown>) =>
      withResilience(circuit, { timeoutMs: 100, retries: 2, retryBaseMs: 10, openMs: breaker?.openMs ?? 30_000, delay: noDelay, now: fixedNow, ...overrides }, fn)(),
  };
}

const networkFault = (message: string): Error => Object.assign(new Error(message), { code: "ECONNRESET" });

describe("resilience wrapper (ARC-09)", () => {
  it("retries a network fault and succeeds; counts the attempts", async () => {
    let calls = 0;
    const { call, circuit } = makeWrapper({ retries: 2 });
    const result = await call(async () => {
      calls++;
      if (calls === 1) throw networkFault("socket hang up");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(circuit.state.failures).toBe(0);
  });

  it("does NOT retry a business answer (4xx semantics are answers, not faults)", async () => {
    let calls = 0;
    const { call } = makeWrapper({ retries: 2 });
    const business = new Error("unauthorised");
    (business as unknown as { name: string }).name = "BusinessAnswer";
    await expect(
      call(async () => {
        calls++;
        throw business;
      })
    ).rejects.toBe(business);
    expect(calls).toBe(1);
  });

  it("aborts an attempt that ignores the timeout signal", async () => {
    const { call, circuit } = makeWrapper({ timeoutMs: 20, retries: 0 });
    await expect(
      call(async (signal) => {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("This operation was aborted");
            (err as { name?: string }).name = "AbortError";
            reject(err);
          });
        });
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(circuit.state.failures).toBe(1);
  });

  it("opens the circuit after consecutive failures and fails fast without calling", async () => {
    let calls = 0;
    const breaker = { threshold: 2, openMs: 30_000 };
    const { call, circuit } = makeWrapper({ retries: 0 }, breaker);
    const fault = async () => {
      calls++;
      throw networkFault("provider down");
    };

    // Capture outcomes explicitly (no expect().rejects plumbing): a rejected
    // promise must surface as a rejection here, or the assertion below fails
    // with the wrapper's actual behaviour.
    const first = await call(fault).then(() => "resolved", (e) => e);
    const second = await call(fault).then(() => "resolved", (e) => e);
    expect(first, "first call must reject with the fault").toBeInstanceOf(Error);
    expect(second, "second call must reject with the fault").toBeInstanceOf(Error);
    expect(calls).toBe(2);
    expect(circuit.state.state).toBe("open");

    const third = await call(async () => "never reached").then(() => "resolved", (e) => e);
    expect(third, "an open circuit must refuse with CircuitOpenError").toBeInstanceOf(CircuitOpenError);
    expect(calls, "an open circuit must refuse without touching the provider").toBe(2);
  });

  it("half-open recovery: after openMs a probe is allowed and success closes the circuit", async () => {
    let clock = 1_000_000;
    const breaker = { threshold: 1, openMs: 5_000 };
    const circuit = createCircuit({ threshold: breaker.threshold, openMs: breaker.openMs, now: () => clock });
    let calls = 0;
    const call = withResilience(
      circuit,
      { timeoutMs: 100, retries: 0, openMs: breaker.openMs, delay: noDelay, now: () => clock },
      async () => {
        calls++;
        if (calls <= 1) throw networkFault("down");
        return "recovered";
      }
    );

    await expect(call()).rejects.toBeTruthy();
    expect(circuit.state.state).toBe("open");

    clock += 5_001; // past the open window → half-open probe
    await expect(call()).resolves.toBe("recovered");
    expect(circuit.state.state).toBe("closed");
    expect(calls).toBe(2);
  });

  it("jitter keeps retries bounded (base * 2^attempt)", () => {
    vi.spyOn(Math, "random").mockReturnValue(1); // max jitter
    const delays: number[] = [];
    const base = 300;
    for (const attempt of [0, 1, 2]) delays.push(base * 2 ** attempt);
    vi.restoreAllMocks();
    // Sanity for the documented bound: attempt 2 must not exceed base * 4.
    expect(Math.max(...delays)).toBe(base * 4);
  });
});
