import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

export type SmsResult = { delivered: boolean; provider: string; error?: string };

/** Mask a phone for logs: first three and last four digits only. */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
}

/** OTP message text, bilingual — deliverable by any gateway as one ASCII-safe string. */
export const otpSmsText = (code: string): string =>
  `AgroBridge verification code: ${code} (valid 5 minutes). Never share this code. | AgroBridge যাচাই কোড: ${code} (৫ মিনিট)। কোডটি কারও সাথে শেয়ার করবেন না।`;

/**
 * One send over an HTTP SMS gateway. Never throws: an OTP request must not
 * fail because the gateway hiccuped — the challenge is already stored, and the
 * caller decides what to tell the user (for password reset the answer is
 * deliberately uniform, so delivery failure changes nothing visible).
 *
 * Contract: POST {to, text, senderId?} with `Authorization: Bearer <key>`
 * when a key is configured. 5xx/429/network failures get exactly one retry
 * (matching the AI adapter's bounded-retry policy); other 4xx are final.
 */
export async function sendViaHttp(
  cfg: { url: string; key?: string; senderId?: string },
  to: string,
  text: string,
): Promise<SmsResult> {
  const body = JSON.stringify({ to, text, ...(cfg.senderId ? { senderId: cfg.senderId } : {}) });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.key) headers.authorization = `Bearer ${cfg.key}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(cfg.url, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        logger.info({ phoneMasked: maskPhone(to), latencyMs: Date.now() - started, attempt }, "sms(http): delivered");
        return { delivered: true, provider: "http" };
      }
      if (res.status < 500 && res.status !== 429) {
        logger.warn({ status: res.status, phoneMasked: maskPhone(to) }, "sms(http): rejected by gateway");
        return { delivered: false, provider: "http", error: `HTTP ${res.status}` };
      }
      logger.warn({ status: res.status, attempt, phoneMasked: maskPhone(to) }, "sms(http): retryable failure");
    } catch (e) {
      logger.warn({ err: (e as Error).message, attempt, phoneMasked: maskPhone(to) }, "sms(http): transport failure");
    }
  }
  return { delivered: false, provider: "http", error: "gateway unreachable" };
}

/**
 * The single SMS entry point for the auth flows (phone verification + password
 * reset). sandbox/none log only — and never log the code itself: outside
 * production the code is echoed in the API response instead, and in production
 * a code in the logs would be an account-takeover vector for anyone with log
 * access.
 */
export async function sendSms(to: string, text: string): Promise<SmsResult> {
  if (env.SMS_PROVIDER === "none") {
    logger.warn({ phoneMasked: maskPhone(to) }, "sms(none): message dropped — no provider configured");
    return { delivered: false, provider: "none" };
  }
  if (env.SMS_PROVIDER === "sandbox") {
    logger.info({ phoneMasked: maskPhone(to) }, "sms(sandbox): message not sent (codes are returned in API responses outside production)");
    return { delivered: false, provider: "sandbox" };
  }
  if (!env.SMS_API_URL) {
    // env.ts aborts production startup in this state; this covers non-production.
    logger.warn({ phoneMasked: maskPhone(to) }, "sms(http): SMS_API_URL missing — message not sent");
    return { delivered: false, provider: "http", error: "SMS_API_URL missing" };
  }
  return sendViaHttp({ url: env.SMS_API_URL, key: env.SMS_API_KEY, senderId: env.SMS_SENDER_ID }, to, text);
}
