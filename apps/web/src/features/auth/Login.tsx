import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setTokens } from "../../lib/api";
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

        {/* Remember-me — cosmetic preference kept from v1, now a real accessible checkbox */}
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-stone-700">
          <span className="relative flex h-[18px] w-[18px] items-center justify-center">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="peer absolute inset-0 h-full w-full appearance-none rounded-[6px] border-2 border-surface-border-strong bg-surface-card checked:border-action checked:bg-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)]"
            />
            <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none relative h-3 w-3 text-white opacity-0 peer-checked:opacity-100">
              <path d="M2 6.5 4.5 9 10 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {t("rememberMe", lang)}
        </label>

        {error && (
          <ErrorBanner
            message={error}
            copyLabel={lang === "bn" ? "কপি" : "Copy"}
            copiedLabel={lang === "bn" ? "কপি হয়েছে!" : "Copied!"}
          />
        )}

        <Button type="submit" variant="cta" size="lg" className="w-full" loading={busy} disabled={busy || inputInvalid}>
          {t("signIn", lang)} <span aria-hidden>→</span>
        </Button>

        {inputInvalid && !busy && <p className="text-center text-xs text-stone-500">{t("fixErrorsNote", lang)}</p>}

        {/* Google sign-in is not wired to a backend flow yet; the affordance
            ships hidden until it is (set VITE_GOOGLE_SIGNIN=1 at build time). */}
        {import.meta.env.VITE_GOOGLE_SIGNIN === "1" && (
          <>
            <div className="flex items-center gap-3 py-1" aria-hidden>
              <span className="h-px flex-1 bg-surface-border" />
              <span className="text-xs font-medium text-stone-500">{t("orDivider", lang)}</span>
              <span className="h-px flex-1 bg-surface-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={() => alert(t("googleComingSoon", lang))}
            >
              <span aria-hidden className="bg-gradient-to-r from-[#4285F4] via-[#34A853] to-[#EA4335] bg-clip-text text-lg font-extrabold text-transparent">G</span>
              {t("googleContinue", lang)}
            </Button>
          </>
        )}
      </form>
    </AuthShell>
  );
}
