import { randomUUID } from "node:crypto";
import { CreatePaymentInput, PaymentIntent, PaymentProvider } from "./types.js";

/**
 * Deterministic sandbox payment provider.
 * - Succeeds unless input.forceFail is set, in which case it refuses to open a
 *   session (the same failure shape a live gateway produces when it cannot
 *   create one).
 * - Every response clearly carries mode:"sandbox".
 * NEVER exposed as a real payment method in production UI.
 *
 * F-14: the payments route's sandbox branch does not call this class — it
 * builds its own SBX- ref — so the methods below are exercised directly by
 * tests/payment-sandbox-provider.test.ts instead of through the route. The
 * class is still the configured provider object (`getPaymentProvider()`), so
 * `name`/`mode` drive `paymentsReadiness()` and the route's mode check.
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = "sandbox";
  readonly mode = "sandbox" as const;

  // eslint-disable-next-line @typescript-eslint/require-await -- the PaymentProvider contract is async (live adapters do I/O); this implementation has nothing to await.
  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    if (input.forceFail) {
      throw new Error("SandboxPaymentProvider: forced failure (forceFail) — no checkout session created");
    }
    const providerRef = `SBX-${randomUUID()}`;
    return { provider: this.name, providerRef, redirectUrl: `/payments/sandbox/${providerRef}` };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async by provider contract; sandbox verification is synchronous by design.
  async verifyPayment(_providerRef: string): Promise<{ status: "SUCCEEDED" | "FAILED" | "PENDING"; amountPaisa?: number }> {
    // In sandbox, verification endpoint receives intended outcome via meta at create time;
    // default flow marks success on explicit confirm call from the API route.
    return { status: "PENDING" };
  }
}
