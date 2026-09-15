import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setTokens } from "../../lib/api";
import { track } from "../../lib/analytics";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { Button, ErrorBanner, Field, Input } from "../../components/ui";
import { BD_PHONE_RE, mapError } from "../../lib/errors-ui";
import { AuthShell, useAuthLang } from "./AuthShell";

export default function Register() {
  const { refresh } = useSession();
  const [uiLang, setUiLang] = useAuthLang();
  const [fullName, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [langPref, setLangPref] = useState<"bn" | "en">("bn");
  const [fieldErrs, setFieldErrs] = useState<{ fullName?: string; phone?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const lang = uiLang;

  const inputInvalid =
    (fullName.trim().length > 0 && fullName.trim().length < 2) ||
    (phone.trim().length > 0 && !BD_PHONE_RE.test(phone.trim())) ||
    (password.length > 0 && password.length < 8);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof fieldErrs = {};
    if (!fullName.trim()) errs.fullName = t("errFieldRequired", lang);
    else if (fullName.trim().length < 2) errs.fullName = t("errNameTooShort", lang);
    if (!phone.trim()) errs.phone = t("errFieldRequired", lang);
    else if (!BD_PHONE_RE.test(phone.trim())) errs.phone = t("errPhoneInvalid", lang);
    if (!password) errs.password = t("errFieldRequired", lang);
    else if (password.length < 8) errs.password = t("errWeakPassword", lang);
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    setError("");
    try {
      const data = await api<{ accessToken: string; refreshToken: string }>("POST", "/auth/register", {
        fullName: fullName.trim(), phone: phone.trim(), password, langPref,
      });
      setTokens(data.accessToken, data.refreshToken);
      track("register_success");
      await refresh();
      nav("/farm");
    } catch (err) {
      setError(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t("registerTitle", lang)}
      subtitle={t("authRegisterSub", lang)}
      lang={lang}
      onToggleLang={(l) => {
        setUiLang(l);
        setLangPref(l); // registration persists the chosen UI language
      }}
      footer={
        <p className="text-center text-sm text-stone-600">
          {lang === "bn" ? "অ্যাকাউন্ট আছে? " : "Have an account? "}
          <Link
            to="/login"
            className="inline-flex items-center gap-0.5 rounded font-bold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
          >
            {lang === "bn" ? "লগইন করুন" : "Log in"} <span aria-hidden>›</span>
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label={t("fullName", lang)} htmlFor="name" error={fieldErrs.fullName}>
          <Input
            id="name"
            autoComplete="name"
            value={fullName}
            onChange={(e) => { setName(e.target.value); setFieldErrs((prev) => ({ ...prev, fullName: undefined })); }}
            onBlur={() => { if (fullName.trim() && fullName.trim().length < 2) setFieldErrs((prev) => ({ ...prev, fullName: t("errNameTooShort", lang) })); }}
            placeholder={t("fullNamePlaceholder", lang)}
            aria-invalid={Boolean(fieldErrs.fullName)}
            aria-describedby={fieldErrs.fullName ? "name-err" : undefined}
          />
        </Field>

        <Field label={t("phone", lang)} htmlFor="rphone" error={fieldErrs.phone}>
          <Input
            id="rphone"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setFieldErrs((prev) => ({ ...prev, phone: undefined })); }}
            onBlur={() => { if (phone.trim() && !BD_PHONE_RE.test(phone.trim())) setFieldErrs((prev) => ({ ...prev, phone: t("errPhoneInvalid", lang) })); }}
            placeholder={t("phonePlaceholder", lang)}
            aria-invalid={Boolean(fieldErrs.phone)}
            aria-describedby={fieldErrs.phone ? "rphone-err" : undefined}
          />
        </Field>

        <Field
          label={t("password", lang)}
          htmlFor="rpass"
          error={fieldErrs.password}
          hint={t("passwordHint", lang)}
        >
          <Input
            id="rpass"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setFieldErrs((prev) => ({ ...prev, password: undefined })); }}
            onBlur={() => { if (password && password.length < 8) setFieldErrs((prev) => ({ ...prev, password: t("errWeakPassword", lang) })); }}
            aria-invalid={Boolean(fieldErrs.password)}
            aria-describedby={fieldErrs.password ? "rpass-err" : undefined}
          />
        </Field>

        <Field label={t("langSelectLabel", lang)}>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("langSelectLabel", lang)}>
            {(["bn", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={langPref === l}
                onClick={() => setLangPref(l)}
                className={`min-h-[44px] rounded-input border py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] motion-reduce:transition-none ${
                  langPref === l
                    ? "border-action bg-brand-50 text-accent ring-1 ring-inset ring-brand-200"
                    : "border-surface-border-strong bg-surface-card text-stone-600 hover:bg-stone-100"
                }`}
              >
                {l === "bn" ? "বাংলা" : "English"}
              </button>
            ))}
          </div>
        </Field>

        {error && (
          <ErrorBanner
            message={error}
            copyLabel={lang === "bn" ? "কপি" : "Copy"}
            copiedLabel={lang === "bn" ? "কপি হয়েছে!" : "Copied!"}
          />
        )}

        <Button type="submit" variant="cta" size="lg" className="w-full" loading={busy} disabled={busy || inputInvalid}>
          {t("signUp", lang)}
        </Button>

        {inputInvalid && !busy && (
          <p className="text-center text-xs text-stone-500">{t("fixErrorsNote", lang)}</p>
        )}
      </form>
    </AuthShell>
  );
}
