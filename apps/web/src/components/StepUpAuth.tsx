import { useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../lib/api";
import type { OtpStepUpResult } from "../lib/api-types";
import { t } from "../lib/i18n";
import type { Lang } from "../lib/i18n";
import { mapError } from "../lib/errors-ui";
import { Button, ErrorBanner, Input, Label, Spinner } from "./ui";

/**
 * The step-up pair (SEC-04): request a fresh one-time code on the signed-in
 * account's phone, then hold the six digits the caller's submit must carry as
 * `otp`. Both gated actions — account deletion (Settings) and the wallet
 * withdrawal — use this same widget against the same endpoint, so the send
 * affordance, the input shape and the error surface cannot drift apart.
 *
 * The sent confirmation reads inline next to the input it unlocks, not as a
 * toast: the code arrives by SMS seconds later, and a toast is gone before it
 * does. The response's `devCode` exists only in dev/test builds for automated
 * tests — deliberately never rendered here.
 *
 * Errors go through mapError: the gate's own codes (OTP_INVALID, OTP_EXPIRED)
 * carry dictionary copy, everything else falls back to the shared mapping.
 */
export function StepUpAuth({
  lang,
  code,
  onCodeChange,
  idPrefix,
  onEnforcement,
}: {
  lang: Lang;
  code: string;
  onCodeChange: (v: string) => void;
  /** Unique per mount — two step-up surfaces on one page must not share input ids. */
  idPrefix: string;
  /** Tells the parent whether the submit must carry `otp` (enforced) or may proceed without it (waived). */
  onEnforcement?: (enforced: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [enforced, setEnforced] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api<OtpStepUpResult>("POST", "/auth/otp/stepup");
      // Waived deployment (placeholder SMS — the code can be issued but never
      // delivered): the gates step aside server-side, so this widget reveals
      // the waiver notice instead of an input the user can never fill.
      setEnforced(res.enforced ?? true);
      onEnforcement?.(res.enforced ?? true);
      setSent(true);
    } catch (e) {
      setErr(mapError(e, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {!sent ? (
        <Button type="button" variant="outline" onClick={() => void send()} disabled={busy} aria-busy={busy || undefined}>
          {busy && <Spinner className="mr-1.5 h-4 w-4" />}
          <KeyRound className="mr-1.5 h-4 w-4" aria-hidden /> {t("stepUpSendCode", lang)}
        </Button>
      ) : sent && !enforced ? (
        <>
          <p className="text-xs font-medium text-stone-600" role="status">
            {t("stepUpWaived", lang)}
          </p>
        </>
      ) : (
        <>
          <p className="text-xs font-medium text-success-text" role="status">
            {t("stepUpSent", lang)}
          </p>
          <div>
            <Label htmlFor={`${idPrefix}-otp`}>{t("otpCodeLabel", lang)}</Label>
            <Input
              id={`${idPrefix}-otp`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, ""))}
              className="max-w-[12rem] tracking-[0.3em]"
            />
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void send()} disabled={busy} aria-busy={busy || undefined}>
            {busy && <Spinner className="mr-1.5 h-4 w-4" />}
            {t("resendCode", lang)}
          </Button>
        </>
      )}
      {err && <ErrorBanner message={err} />}
    </div>
  );
}
