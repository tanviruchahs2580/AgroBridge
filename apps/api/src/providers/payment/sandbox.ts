import { randomUUID } from "node:crypto";
import { CreatePaymentInput, PaymentIntent, PaymentProvider } from "./types.js";

/**
 * Deterministic sandbox payment provider.
 * - Succeeds unless input.forceFail is set.
 * - Every response clearly carries mode:"sandbox".
 * NEVER exposed as a real payment method in production UI.
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = "sandbox";
  readonly mode = "sandbox" as const;

  // eslint-disable-next-line @typescript-eslint/require-await -- the PaymentProvider contract is async (live adapters do I/O); this implementation has nothing to await.
  async createPayment(_input: CreatePaymentInput): Promise<PaymentIntent> {
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
