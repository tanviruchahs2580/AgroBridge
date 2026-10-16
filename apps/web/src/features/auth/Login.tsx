import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setTokens } from "../../lib/api";
import { setRemember as persistRememberPreference } from "../../lib/sessionManager";
import { track } from "../../lib/analytics";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { Button, ErrorBanner, Field, IconButton, Input } from "../../components/ui";
import { Eye, EyeOff, Lock, Phone } from "lucide-react";
import { BD_PHONE_RE, mapError } from "../../lib/errors-ui";
import { AuthShell, useAuthLang } from "./AuthShell";

export default function Login() {
  const { refresh } = useSession();
  const [lang, setLang] = useAuthLang();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [fieldErrs, setFieldErrs] = useState<{ phone?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const inputInvalid =
    (phone.trim().length > 0 && !BD_PHONE_RE.test(phone.trim())) ||
    (password.length > 0 && password.length < 8);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof fieldErrs = {};
    if (!phone.trim()) errs.phone = t("errFieldRequired", lang);
    else if (!BD_PHONE_RE.test(phone.trim())) errs.phone = t("errPhoneInvalid", lang);
    if (!password) errs.password = t("errFieldRequired", lang);
    else if (password.length < 8) errs.password = t("errWeakPassword", lang);
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setError("");
    try {
      // Remember-me decides WHERE the token pair lives: localStorage (persist)
      // vs sessionStorage (this tab only). The preference must be recorded
      // BEFORE setTokens writes the pair.
      persistRememberPreference(remember);
      const data = await api<{ accessToken: string; refreshToken: string }>("POST", "/auth/login", { phone: phone.trim(), password });
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
      title={t("authWelcome", lang)}
      subtitle={t("authWelcomeSub", lang)}
      lang={lang}
      onToggleLang={setLang}
      footer={
        <>
          <p className="text-center text-sm text-stone-600">
            {lang === "bn" ? "অ্যাকাউন্ট নেই? " : "No account yet? "}
            <Link
              to="/register"
              className="inline-flex items-center gap-0.5 rounded font-bold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
            >
              {lang === "bn" ? "রেজিস্ট্রেশন করুন" : "Register"} <span aria-hidden>›</span>
            </Link>
          </p>

          {import.meta.env.DEV && (
            <div className="mt-3 rounded-input border border-surface-border bg-glass px-3 py-2 text-center text-[11px] leading-relaxed text-stone-600 backdrop-blur">
              <p className="font-semibold uppercase tracking-wide">{t("demoCredentialsTitle", lang)}</p>
              <p>{t("demoCredentialsBody", lang)}</p>
            </div>
          )}
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label={t("phone", lang)} htmlFor="phone" error={fieldErrs.phone}>
          <div className="relative">
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
              onBlur={() => { if (password && password.length < 8) setFieldErrs((p) => ({ ...p, password: t("errWeakPassword", lang) })); }}
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
            copyLabel={lang === "bn" ? "কপি" : "Copy"}
            copiedLabel={lang === "bn" ? "কপি হয়েছে!" : "Copied!"}
          />
        )}

        <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm font-medium text-white/90">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-[18px] w-[18px] appearance-none rounded-[5px] border-2 border-white/50 checked:border-transparent checked:bg-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            style={{ backgroundImage: remember ? 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 12 12%27%3E%3Cpath d=%27M2 6.5 4.5 9 10 3%27 fill=%27none%27 stroke=%27white%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E")' : undefined, backgroundRepeat: "no-repeat", backgroundPosition: "center", backgroundSize: "10px" }}
          />
          {t("rememberMe", lang)}
        </label>

        <Button type="submit" variant="cta" size="lg" className="w-full" loading={busy} disabled={busy || inputInvalid}>
          {t("signIn", lang)} <span aria-hidden>→</span>
        </Button>

        {inputInvalid && !busy && <p className="text-center text-xs text-stone-500">{t("fixErrorsNote", lang)}</p>}
      </form>
    </AuthShell>
  );
}
