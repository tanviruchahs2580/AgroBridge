import { describe, expect, it } from "vitest";
import { SandboxPaymentProvider } from "../src/providers/payment/sandbox.js";

/**
 * F-14: `payment/sandbox.ts` is the pilot's live payment mode, but the
 * payments route's sandbox branch never calls it — it builds its own `SBX-`
 * reference — so the class had 0/2 function coverage while vitest.config.ts
 * asserted a test exercised it. These are the direct tests that make that
 * sentence true, and they pin the documented `forceFail` hook the class used to
 * ignore.
 *
 * Deliberately not routed through the API: the route behaviour (intent →
 * confirm → SUCCEEDED) is covered by the journey/payment suites; this file is
 * about the provider object itself.
 */
describe("SandboxPaymentProvider (F-14)", () => {
  const provider = new SandboxPaymentProvider();
  const input = {
    amountPaisa: 50_000,
    refNo: "PAY-F14-0001",
    customerPhone: "01700000000",
    returnBaseUrl: "https://api.example.test",
  };

  it("labels every response as sandbox and points at its own reference", async () => {
    expect(provider.mode).toBe("sandbox");
    expect(provider.name).toBe("sandbox");

    const intent = await provider.createPayment(input);
    expect(intent.provider).toBe("sandbox");
    // SBX- followed by a UUID — greppable in logs, clearly not a gateway ref.
    expect(intent.providerRef).toMatch(/^SBX-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(intent.redirectUrl).toBe(`/payments/sandbox/${intent.providerRef}`);
  });

  it("honours forceFail — the documented hook refuses to open a session", async () => {
    // Before F-14 the hook was documented in sandbox.ts and defined on
    // CreatePaymentInput, but never read: a caller asking for the failure path
    // silently got a success intent.
    await expect(provider.createPayment({ ...input, forceFail: true })).rejects.toThrow(/forced failure/);
    // And a non-forced call still succeeds — the branch is not "always fail".
    await expect(provider.createPayment({ ...input, forceFail: false })).resolves.toHaveProperty("providerRef");
  });

  it("verifyPayment stays PENDING — only the route's explicit confirm claims a sandbox payment", async () => {
    const verdict = await provider.verifyPayment("SBX-any-reference");
    expect(verdict).toEqual({ status: "PENDING" });
  });
});
