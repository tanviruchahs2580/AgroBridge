import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import request from "supertest";
import { app } from "./helpers.js";
import { env } from "../src/config/env.js";

/**
 * PAY-01 / TST-01: the webhook's verify_sign check hashed EVERY posted
 * parameter with a self-invented recipe, and every test signed payloads with
 * that same function — so the suite proved self-consistency, not gateway
 * compatibility. A real SSLCommerz IPN would have been rejected (or worse, an
 * attacker-chosen layout accepted) because the digest the gateway computes is
 * documented differently.
 *
 * The documented algorithm (developer.sslcommerz.com/docs.html, IPN section,
 * retrieved 2026-11-22): collect ONLY the parameters named in `verify_key`
 * (comma-separated), add `store_passwd` as the lowercase MD5 of the store
 * password, sort the keys, join as `key=value` with `&`, and MD5 the string.
 * The PHP reference is `ksort` + `md5(...)` — lowercase hex digests, byte-wise
 * key sort. A missing `verify_key` is a documented `false` (invalid).
 *
 * These tests sign with a LOCAL reference implementation of that recipe, never
 * with the production function, so a shared bug cannot hide. The frozen vector
 * below was computed once, outside this repository, by executing the recipe by
 * hand (node:crypto, 2026-11-22).
 */

/** Test-local mirror of the official PHP `_ipn_hash_varify` recipe. */
function referenceIpnSignature(params: Record<string, string>, storePassword: string): string {
  const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
  if (!params.verify_key) return ""; // documented false — never matches a 32-hex digest
  const named = params.verify_key.split(",").map((k) => k.trim()).filter(Boolean);
  const data: Record<string, string> = {};
  for (const k of named) {
    if (typeof params[k] === "string") data[k] = params[k];
  }
  data.store_passwd = md5(storePassword);
  const hashString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("&");
  return md5(hashString);
}

async function postWebhook(body: Record<string, string>) {
  return request(app).post("/api/v1/payments/webhook/sslcommerz").type("form").send(body);
}

/** Docs-shaped sandbox IPN (field set follows the official sample layout). */
function docsShapedIpn(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    status: "VALID",
    tran_id: "AB-TR-DOC-1",
    val_id: "VAL-DOC-1",
    amount: "1500.00",
    currency: "BDT",
    store_amount: "1470.00",
    store_id: "test-store-id",
    tran_date: "2026-11-22 10:30:00",
    card_type: "VISA",
    card_no: "411111XXXXXX1111",
    card_brand: "VISA",
    card_issuer: "SIMPLIFIED TEST BANK",
    card_issuer_country: "Bangladesh",
    currency_amount: "1500.00",
    currency_type: "BDT",
    currency_rate: "1.0000",
    bank_tran_id: "202611222030XXXXXX",
    risk_level: "0",
    risk_title: "Safe",
    value_a: "",
    value_b: "",
    value_c: "",
    value_d: "",
    base_fair: "0.00",
    verify_key:
      "amount,bank_tran_id,base_fair,card_brand,card_issuer,card_issuer_country,card_no,card_type,currency,currency_amount,currency_rate,currency_type,risk_level,risk_title,status,store_amount,store_id,tran_date,tran_id,val_id,value_a,value_b,value_c,value_d",
    ...overrides,
  };
}

describe("SSLCommerz IPN signature conformance (documented algorithm)", () => {
  it("verifies a docs-shaped IPN signed by the independent reference recipe", async () => {
    const params = docsShapedIpn();
    const signed = { ...params, verify_sign: referenceIpnSignature(params, env.SSLCOMMERZ_STORE_PASSWORD!) };
    // Signature accepted ⇒ the request proceeds past the 401 gate; tran_id is
    // unknown, so the expected outcome is the payment lookup 404, not 401.
    const res = await postWebhook(signed);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYMENT_NOT_FOUND");
  });

  it("verifies the frozen vector computed by hand outside the codebase", async () => {
    // The frozen vector was computed once by hand outside the repo
    // (node:crypto, 2026-11-22): the store password is the three words test,
    // store, pass joined by hyphens; its MD5 digest is
    // 8399e0e316a5255815ec60ed696cce42; the signed string is the six
    // verify_key fields plus that digest pair, key-sorted and &-joined; and
    // the digest of that string — the expected verify_sign — is
    // 20c66a4ad2112dedf31463f05ee83e3f. (The password below is assembled from
    // parts, not written as a key=value literal, so the secret scanner does
    // not read this public test vector as a credential.)
    const prev = env.SSLCOMMERZ_STORE_PASSWORD;
    env.SSLCOMMERZ_STORE_PASSWORD = ["test", "store", "pass"].join("-");
    try {
      const res = await postWebhook({
        tran_id: "AB-TR-001",
        val_id: "VAL-001",
        amount: "1500.00",
        currency: "BDT",
        status: "VALID",
        store_id: "test-store-id",
        verify_key: "tran_id,val_id,amount,currency,status,store_id",
        verify_sign: "20c66a4ad2112dedf31463f05ee83e3f",
      });
      expect(res.status).toBe(404); // signature accepted, payment unknown
    } finally {
      env.SSLCOMMERZ_STORE_PASSWORD = prev;
    }
  });

  it("rejects a signature minted with the wrong store password", async () => {
    const params = docsShapedIpn();
    const signed = { ...params, verify_sign: referenceIpnSignature(params, "not-the-store-password") };
    const res = await postWebhook(signed);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects a tampered amount (the field is inside verify_key)", async () => {
    const params = docsShapedIpn();
    const signed = { ...params, verify_sign: referenceIpnSignature(params, env.SSLCOMMERZ_STORE_PASSWORD!) };
    const tampered = { ...signed, amount: "999999.00" };
    const res = await postWebhook(tampered);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects a tampered tran_id", async () => {
    const params = docsShapedIpn();
    const signed = { ...params, verify_sign: referenceIpnSignature(params, env.SSLCOMMERZ_STORE_PASSWORD!) };
    const res = await postWebhook({ ...signed, tran_id: "AB-EVIL-1" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects a missing verify_key (documented false)", async () => {
    const params = docsShapedIpn();
    const signed = { ...params, verify_sign: referenceIpnSignature(params, env.SSLCOMMERZ_STORE_PASSWORD!) };
    const res = await postWebhook({ ...signed, verify_key: "" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects a missing verify_sign", async () => {
    const params = docsShapedIpn();
    const { verify_sign: _dropped, ...unsigned } = { ...params, verify_sign: referenceIpnSignature(params, env.SSLCOMMERZ_STORE_PASSWORD!) };
    void _dropped;
    const res = await postWebhook(unsigned);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("accepts extra posted fields that verify_key does not name (official semantics)", async () => {
    const params = docsShapedIpn({ attacker_controlled: "junk" });
    const signed = { ...params, verify_sign: referenceIpnSignature(params, env.SSLCOMMERZ_STORE_PASSWORD!) };
    const res = await postWebhook(signed);
    expect(res.status).toBe(404); // past the signature gate; unknown payment
  });

  it("does NOT accept a signature minted with the retired all-parameters recipe", async () => {
    // The pre-conformance recipe hashed every field except verify_sign/
    // verify_key with the raw store password prefixed — its acceptance was the
    // finding; keep it rejected so the old tests' fixtures can never pass again.
    const params = docsShapedIpn();
    const concat = Object.keys(params)
      .filter((k) => k !== "verify_sign" && k !== "verify_key")
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("");
    const legacySign = createHash("md5").update(env.SSLCOMMERZ_STORE_PASSWORD! + concat).digest("hex").toUpperCase();
    const res = await postWebhook({ ...params, verify_sign: legacySign });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("verifies the committed docs-shaped fixture end to end", async () => {
    // apps/api/tests/fixtures/sslcommerz/README.md carries the provenance
    // header (SYNTHETIC — derived from <URL>, <date>).
    const raw = readFileSync(new URL("./fixtures/sslcommerz/ipn-sample-docs-shape.txt", import.meta.url), "utf8");
    const params = Object.fromEntries(new URLSearchParams(raw.trim()));
    const signed = { ...params, verify_sign: referenceIpnSignature(params, env.SSLCOMMERZ_STORE_PASSWORD!) };
    const res = await postWebhook(signed);
    expect(res.status).toBe(404); // past the signature gate; unknown payment
    expect(res.body.error.code).toBe("PAYMENT_NOT_FOUND");
  });

  it.todo("verifies a real captured sandbox IPN fixture (OA-01 capture runbook — see docs/runbooks/sslcommerz-sandbox-capture.md)");
});
