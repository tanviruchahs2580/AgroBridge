import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setTokens } from "../../lib/api";
import { track } from "../../lib/analytics";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { Button, ErrorBanner, Field, IconButton, Input } from "../../components/ui";
import { Download, Eye, EyeOff, Lock, Phone } from "lucide-react";
import { BD_PHONE_RE, mapError } from "../../lib/errors-ui";
import type { AuthSession } from "../../lib/api-types";
import { AuthShell } from "./AuthShell";
import { usePublicLang } from "../../lib/publicLanguage";
import { useInstallPrompt } from "../../lib/installPrompt";

export default function Login() {
  const { refresh } = useSession();
  const [lang, setLang] = usePublicLang();
  // The browser's own install prompt, offered here because Chrome was not
  // showing its own on this build (lib/installPrompt.ts). Purely additive: it
  // touches no auth state and renders nothing when the prompt is unavailable.
  const { canInstall, promptInstall } = useInstallPrompt();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [fieldErrs, setFieldErrs] = useState<{ phone?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  // Authentication, not registration: the API's login schema is
  // `password: z.string().min(1)`, so a client rule that demands 8 characters
  // here (a) reported a mistyped short password as "weak" instead of letting the
  // server answer "wrong password", (b) left the submit button dead until blur,
  // and (c) made a legacy/seeded account with a short password impossible to sign
  // into from the web client. The length policy belongs on Register and Reset.
  const inputInvalid = phone.trim().length > 0 && !BD_PHONE_RE.test(phone.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof fieldErrs = {};
    if (!phone.trim()) errs.phone = t("errFieldRequired", lang);
    else if (!BD_PHONE_RE.test(phone.trim())) errs.phone = t("errPhoneInvalid", lang);
    if (!password) errs.password = t("errFieldRequired", lang);
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setError("");
    try {
      // The declared contract shape (lib/api-types), not a locally invented
      // subset: a hand-written `{ accessToken, refreshToken }` here was a third
      // declaration of the login response that could drift from the API's.
      const data = await api<AuthSession>("POST", "/auth/login", { phone: phone.trim(), password });
      setTokens(data.accessToken, data.refreshToken);
      track("login_success");
      await refresh();
      nav("/");
    } catch (err) {
      setError(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      // REVERSAL, 2026-11-12: the owner's approved login mock supersedes the
      // "the task, not a welcome" call this prop used to carry. The h1 is the
      // mock's welcome and the sub-line names the task, so both jobs are still
      // done — in the other order. The route title (App.tsx) stays "লগইন".
      title={t("authWelcome", lang)}
      subline={t("authLoginSub", lang)}
      features
      lang={lang}
      onToggleLang={setLang}
      footer={
        <>
          <p className="text-center text-sm text-stone-600">
            {t("authNoAccountPrefix", lang)}{" "}
            <Link
              to="/register"
              className="inline-flex items-center gap-0.5 rounded font-bold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
            >
              {t("authRegisterLink", lang)} <span aria-hidden>›</span>
            </Link>
          </p>

          {/* Install: a quiet secondary control under the way to Register. It
              exists only while Chrome holds a real install prompt; with none,
              there is nothing to render and a button that cannot install would
              be a lie. */}
          {canInstall && (
            <Button
              type="button"
              variant="outline"
              className="auth-install mt-3 min-h-[44px] w-full"
              onClick={() => void promptInstall()}
            >
              <Download className="h-4 w-4" aria-hidden /> {t("installApp", lang)}
            </Button>
          )}
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label={t("phone", lang)} htmlFor="phone" error={fieldErrs.phone}>
          <div className="relative">
            {/* Decorative field icon — the visible <label> carries the meaning, so
 it is exempt from text contrast; on the mobile photo card
 index.css repoints.text-stone-400 to white/60.*/}
            <Phone aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" style={{ width: 18, height: 18 }} />
            <Input
              id="phone"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setFieldErrs((p) => ({ ...p, phone: undefined })); }}
              onBlur={() => { if (phone.trim() && !BD_PHONE_RE.test(phone.trim())) setFieldErrs((p) => ({ ...p, phone: t("errPhoneInvalid", lang) })); }}
              placeholder={t("phonePlaceholder", lang)}
              className="pl-10"
              aria-invalid={Boolean(fieldErrs.phone)}
              aria-describedby={fieldErrs.phone ? "phone-err" : undefined}
            />
          </div>
        </Field>

        <Field label={t("password", lang)} htmlFor="password" error={fieldErrs.password}>
          <div className="relative">
            <Lock aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" style={{ width: 18, height: 18 }} />
            <Input
              id="password"
              type={showPass ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setFieldErrs((p) => ({ ...p, password: undefined })); }}
              placeholder={t("passwordPlaceholder", lang)}
              className="pl-10 pr-12"
              aria-invalid={Boolean(fieldErrs.password)}
              aria-describedby={fieldErrs.password ? "password-err" : undefined}
            />
            <IconButton
              label={showPass ? t("hidePassword", lang) : t("showPassword", lang)}
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-0.5 top-1/2 -translate-y-1/2"
            >
              {showPass ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
            </IconButton>
          </div>
        </Field>

        {error && (
          <ErrorBanner
            message={error}
            copyLabel={t("errCopy", lang)}
            copiedLabel={t("errCopied", lang)}
          />
        )}

        <Button type="submit" variant="cta" size="lg" className="w-full" loading={busy} disabled={busy || inputInvalid}>
          {t("signIn", lang)} <span aria-hidden>→</span>
        </Button>

        {/* Recovery entry point: without it a farmer who forgot the password
 has no way back into the account they already own.*/}
        <p className="text-center">
          <Link
            to="/reset"
            className="inline-flex items-center rounded font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
          >
            {t("forgotPasswordLink", lang)}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
