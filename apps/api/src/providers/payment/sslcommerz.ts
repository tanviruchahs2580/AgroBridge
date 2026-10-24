import { env } from "../../config/env.js";
import type { CreatePaymentInput, PaymentIntent, PaymentProvider } from "./types.js";
import { logger } from "../../lib/logger.js";

/**
 * The provider is constructed only when both credentials are configured
 * (providers/payment/index.ts gates on them), so a missing value here is a
 * wiring bug — fail with a named error instead of a non-null assertion.
 */
function requireCredential(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required when SSLCommerzProvider is instantiated`);
  return value;
}

/**
 * SSLCommerz adapter — production gateway.
 * Requires SSLCOMMERZ_STORE_ID / PASSWORD. Intent creation posts to SSLCommerz
 * session API; payment verification chains through:
 *   1. SSLCommerz Validation Server API (primary)
 *   2. Transaction Query API (fallback)
 *   3. Webhook-driven confirmation (async, not visible in this module)
 *
 * The `val_id` returned from createPayment is captured and used for
 * synchronous verification. If val_id is missing we fall back to
 * transaction_id matching via the query API.
 *
 * Until credentials are present the provider is not instantiated (sandbox remains).
 */
export class SSLCommerzProvider implements PaymentProvider {
  readonly name = "sslcommerz";
  readonly mode = "live" as const;
  private storeId = requireCredential(env.SSLCOMMERZ_STORE_ID, "SSLCOMMERZ_STORE_ID");
  private storePass = requireCredential(env.SSLCOMMERZ_STORE_PASSWORD, "SSLCOMMERZ_STORE_PASSWORD");
  private isSandbox = env.SSLCOMMERZ_SANDBOX !== "false";

  private baseUrl() {
    return this.isSandbox
      ? "https://sandbox.sslcommerz.com/gwprocess/v4/api.php"
      : "https://securepay.sslcommerz.com/gwprocess/v4/api.php";
  }

  private validatorUrl() {
    return this.isSandbox
      ? "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"
      : "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php";
  }

  private transactionQueryUrl() {
    return this.isSandbox
      ? "https://sandbox.sslcommerz.com/lp/txn/query"
      : "https://securepay.sslcommerz.com/lp/txn/query";
  }

  // -----------------------------------------------------------------------
  // Payment intent creation
  // -----------------------------------------------------------------------

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    if (!this.storeId || !this.storePass) throw new Error("SSLCommerz credentials not configured");

    try {
      const res = await fetch(this.baseUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          store_id: this.storeId,
          store_passwd: this.storePass,
          total_amount: (input.amountPaisa / 100).toFixed(2),
          currency: "BDT",
          tran_id: input.refNo,
          success_url: `${input.returnBaseUrl}/payments/gateway/return/success`,
          fail_url: `${input.returnBaseUrl}/payments/gateway/return/fail`,
          cancel_url: `${input.returnBaseUrl}/payments/gateway/return/cancel`,
          cus_phone: input.customerPhone,
          product_category: "general",
          shipping_method: "NO",
          num_of_item: "1",
        }).toString(),
      });

      if (!res.ok) throw new Error(`SSLCommerz create failed ${res.status}`);

      // Try JSON first (v4 API typically returns JSON)
      let j: Record<string, string>;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        j = await res.json() as Record<string, string>;
      } else {
        // Fallback: parse form-encoded response
        const text = await res.text();
        const params = new URLSearchParams(text);
        j = Object.fromEntries(params.entries());
      }

      const gatewayUrl = j.GatewayPageURL ?? j.gatewayPageURL;
      const sessionKey = j.sessionkey ?? j.Sessionkey;
      const valId = j.val_id ?? j.Val_id;
      const trxId = j.transactionId ?? j.tran_id;

      if (gatewayUrl) {
        return {
          provider: this.name,
          // providerRef is the MERCHANT reference (tran_id = our refNo): it is
          // the only key the Transaction Query API accepts, and it stays
          // resolvable even when the gateway session keys rotate. The
          // gateway-side keys (val_id, sessionkey) travel in meta, where
          // verifyPayment picks them up for the Validation API.
          providerRef: input.refNo,
          redirectUrl: gatewayUrl,
          meta: { valId, sessionKey, transactionId: trxId, provider: this.name },
        };
      }

      throw new Error(`SSLCommerz unexpected response ${JSON.stringify(j).slice(0, 300)}`);
    } catch (e) {
      const err = e as Error;
      logger.warn({ err: err.message }, "SSLCommerz createPayment failed, caller must handle");
      // DEF-09: When the gateway is unreachable, surface a clear error so the
      // caller (payments.service / checkout flow) can fall back to sandbox or
      // surface a user-friendly message instead of a hard 500.
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Payment verification
  // -----------------------------------------------------------------------

  async verifyPayment(
    providerRef: string,
    meta?: Record<string, unknown>
  ): Promise<{ status: "SUCCEEDED" | "FAILED" | "PENDING"; amountPaisa?: number }> {
    if (!this.storeId || !this.storePass) {
      return { status: "PENDING" };
    }

    // The Validation Server API resolves a val_id (issued at session creation
    // and stored in payment meta); the Transaction Query API resolves the
    // merchant orderNo (our refNo/tran_id). Using either key for the other
    // API silently degrades every reconciliation to PENDING — so each API
    // gets exactly the key it understands.
    const metaValId = meta?.valId;
    const valId = typeof metaValId === "string" && metaValId ? metaValId : "";

    /** Gateway amounts arrive as BDT decimals; paisa must round exactly once. */
    const toPaisa = (raw: unknown): number | undefined => {
      if (raw == null || raw === "") return undefined;
      const paisa = Math.round(Number(raw) * 100);
      return Number.isFinite(paisa) ? paisa : undefined;
    };

    // ── Primary: Validation Server API (val_id from payment meta) ───────
    if (valId) {
      try {
        const validatorRes = await fetch(this.validatorUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(15_000),
          body: new URLSearchParams({
            val_id: valId,
            store_id: this.storeId,
            store_passwd: this.storePass,
          }).toString(),
        });

        if (validatorRes.ok) {
          // SSLCommerz validator returns JSON with `status` + `transactionStatus`
          const raw = await validatorRes.text();
          const j = JSON.parse(raw) as Record<string, unknown>;

          const txStatus = (j.transactionStatus ?? j.status ?? "") as string;

          if (txStatus === "VALID" || txStatus === "VALIDATED") {
            // A success without a resolvable amount cannot be cross-checked
            // against the payment, so it must not be confirmed here — the
            // signed webhook remains the authority for that session.
            const amountPaisa = toPaisa(j.amount);
            if (amountPaisa === undefined) {
              logger.warn({ val_id: valId }, "SSLCom validator returned success without a usable amount — staying PENDING");
              return { status: "PENDING" };
            }
            return { status: "SUCCEEDED", amountPaisa };
          }

          if (txStatus === "INVALID" || txStatus === "FAILED" || txStatus === "CLOSED") {
            return { status: "FAILED" };
          }

          // Unknown status — fall through to transaction query
          logger.debug({ txStatus, val_id: valId }, "SSLCom-validator returned unknown tx status, falling back to query API");
        }
      } catch (e) {
        logger.debug({ err: (e as Error).message }, "SSLCom validator API failed, falling back to transaction query");
      }
    }

    // ── Fallback: Transaction Query API (orderNo = our refNo) ───────────
    try {
      const queryRes = await fetch(this.transactionQueryUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({
          orderNo: providerRef,
          store_id: this.storeId,
          store_passwd: this.storePass,
        }).toString(),
      });

      if (queryRes.ok) {
        const j = (await queryRes.json()) as Record<string, unknown>;
        const txStatus = (j.transactionStatus ?? j.status ?? "") as string;

        if (txStatus === "VALID" || txStatus === "VALIDATED" || txStatus === "Completed") {
          const amountPaisa = toPaisa(j.amount);
          if (amountPaisa === undefined) {
            logger.warn({ orderNo: providerRef }, "SSLCom transaction query returned success without a usable amount — staying PENDING");
            return { status: "PENDING" };
          }
          return { status: "SUCCEEDED", amountPaisa };
        }

        if (txStatus === "INVALID" || txStatus === "FAILED" || txStatus === "CLOSED") {
          return { status: "FAILED" };
        }

        // Still unknown — store the partial result and mark pending for
        // retry. The async webhook will be the final authority.
        logger.debug({ txStatus, orderNo: providerRef }, "SSLCom transaction query returned unknown status — pending retry");
      }
    } catch (e) {
      logger.debug({ err: (e as Error).message }, "SSLCom transaction query API also failed");
    }

    // ── Graceful fallback: unknown or unreachable gateway ───────────────
    // Do NOT default to SUCCEEDED — that would confirm payments that may
    // have failed. Return PENDING so the caller (or webhook) can retry.
    return { status: "PENDING" };
  }

  static isConfigured(): boolean {
    return Boolean(env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD);
  }
}
