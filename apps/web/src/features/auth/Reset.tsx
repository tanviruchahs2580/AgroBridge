import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button, ErrorBanner, Field, Input } from "../../components/ui";
import { BD_PHONE_RE, mapError } from "../../lib/errors-ui";
import { AuthShell } from "./AuthShell";
import { usePublicLang } from "../../lib/publicLanguage";

/**
 * Password recovery, in the two steps the API exposes:
 *   POST /auth/password/forgot  { phone }                    → always 200
 *   POST /auth/password/reset   { phone, otp, newPassword }
 * The forgot endpoint answers 200 whether or not the number has an account, so
 * the screen must never read a *successful* send as proof the account exists —
 * it just moves on to the code step, and only the code can be wrong.
 */
export default function Reset() {
  const [lang, setLang] = usePublicLang();
  const [step, setStep] = useState<"phone" | "code" | "done">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrs, setFieldErrs] = useState<{ phone?: string; otp?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) {
      setFieldErrs({ phone: t("errFieldRequired", lang) });
      return;
    }
    if (!BD_PHONE_RE.test(trimmed)) {
      setFieldErrs({ phone: t("errPhoneInvalid", lang) });
      return;
    }
    setFieldErrs({});
    setBusy(true);
    setError("");
    try {
      await api("POST", "/auth/password/forgot", { phone: trimmed });
      setOtp("");
      setStep("code");
    } catch (err) {
      setError(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof fieldErrs = {};
    if (!otp.trim()) errs.otp = t("errFieldRequired", lang);
    else if (!/^\d{6}$/.test(otp.trim())) errs.otp = t("errOtpFormat", lang);
    if (!password) errs.password = t("errFieldRequired", lang);
    else if (password.length < 8) errs.password = t("errWeakPassword", lang);
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setError("");
    try {
      await api("POST", "/auth/password/reset", { phone: phone.trim(), otp: otp.trim(), newPassword: password });
      setPassword("");
      setStep("done");
    } catch (err) {
      setError(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t("resetTitle", lang)}
      subtitle={t("resetSubtitle", lang)}
      lang={lang}
      onToggleLang={setLang}
      footer={
        <p className="text-center text-sm text-stone-600">
          {t("authHaveAccountPrefix", lang)}{" "}
          <Link
            to="/login"
            className="inline-flex items-center gap-0.5 rounded font-bold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
          >
            {t("authLoginLink", lang)} <span aria-hidden>›</span>
          </Link>
        </p>
      }
    >
      {step === "done" ? (
        <div className="space-y-4">
          <p role="status" className="text-sm font-medium text-success-text">
            {t("resetSuccess", lang)}
          </p>
          <Button type="button" variant="cta" size="lg" className="w-full" onClick={() => nav("/login")}>
            {t("authLoginLink", lang)}
          </Button>
        </div>
      ) : step === "phone" ? (
        <form onSubmit={requestCode} noValidate className="space-y-4">
          <Field label={t("phone", lang)} htmlFor="reset-phone" error={fieldErrs.phone}>
            <Input
              id="reset-phone"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setFieldErrs((p) => ({ ...p, phone: undefined }));
              }}
              placeholder={t("phonePlaceholder", lang)}
              aria-invalid={Boolean(fieldErrs.phone)}
              aria-describedby={fieldErrs.phone ? "reset-phone-err" : undefined}
            />
          </Field>

          {error && <ErrorBanner message={error} copyLabel={t("errCopy", lang)} copiedLabel={t("errCopied", lang)} />}

          <Button type="submit" variant="cta" size="lg" className="w-full" loading={busy} disabled={busy}>
            {t("sendCode", lang)}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitReset} noValidate className="space-y-4">
          <p role="status" className="text-sm text-stone-600">
            {t("resetCodeSent", lang)}
          </p>

          <Field label={t("otpCodeLabel", lang)} htmlFor="reset-otp" error={fieldErrs.otp}>
            <Input
              id="reset-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, ""));
                setFieldErrs((p) => ({ ...p, otp: undefined }));
              }}
              className="max-w-[12rem] tracking-[0.3em]"
              aria-invalid={Boolean(fieldErrs.otp)}
              aria-describedby={fieldErrs.otp ? "reset-otp-err" : undefined}
            />
          </Field>

          <Field label={t("newPassword", lang)} htmlFor="reset-password" error={fieldErrs.password} hint={t("passwordHint", lang)}>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErrs((p) => ({ ...p, password: undefined }));
              }}
              aria-invalid={Boolean(fieldErrs.password)}
              aria-describedby={fieldErrs.password ? "reset-password-err" : undefined}
            />
          </Field>

          {error && <ErrorBanner message={error} copyLabel={t("errCopy", lang)} copiedLabel={t("errCopied", lang)} />}

          <Button type="submit" variant="cta" size="lg" className="w-full" loading={busy} disabled={busy}>
            {t("resetSubmit", lang)}
          </Button>

          <button
            type="button"
            onClick={() => {
              setError("");
              setFieldErrs({});
              setStep("phone");
            }}
            className="w-full rounded text-center text-xs font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
          >
            {t("resetChangeNumber", lang)}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
