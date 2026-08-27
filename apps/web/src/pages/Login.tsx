import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setTokens } from "../lib/api.js";
import { track } from "../lib/analytics.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import { Sprout } from "lucide-react";
import { Button, Card, ErrorBanner, Input, Label } from "../components/ui.jsx";
import { BD_PHONE_RE, mapError } from "../lib/errors-ui.js";

export default function Login() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrs, setFieldErrs] = useState<{ phone?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { refresh } = useSession();

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-green-50 to-stone-100 px-2 sm:px-4">
      <div className="w-full max-w-md min-w-0 overflow-hidden">
        <div className="mb-6 text-center">
          <Sprout className="mx-auto h-10 w-10 text-green-700" aria-hidden />
          <h1 className="mt-2 text-2xl font-bold text-green-800">{t("appName", lang)}</h1>
          <p className="text-xs text-stone-600">{t("tagline", lang)}</p>
        </div>
        <Card className="min-w-0 overflow-hidden">
          <form onSubmit={submit} noValidate className="space-y-4">
            <div>
              <Label htmlFor="phone">{t("phone", lang)}</Label>
              <Input
                id="phone"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setFieldErrs((prev) => ({ ...prev, phone: undefined })); }}
                onBlur={() => { if (phone.trim() && !BD_PHONE_RE.test(phone.trim())) setFieldErrs((prev) => ({ ...prev, phone: t("errPhoneInvalid", lang) })); }}
                placeholder={t("phonePlaceholder", lang)}
                aria-invalid={Boolean(fieldErrs.phone)}
                aria-describedby={fieldErrs.phone ? "phone-err" : undefined}
              />
              {fieldErrs.phone && <p id="phone-err" role="alert" className="mt-1 text-xs text-red-600">{fieldErrs.phone}</p>}
            </div>
            <div>
              <Label htmlFor="password">{t("password", lang)}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFieldErrs((prev) => ({ ...prev, password: undefined })); }}
                onBlur={() => { if (password && password.length < 8) setFieldErrs((prev) => ({ ...prev, password: t("errWeakPassword", lang) })); }}
                aria-invalid={Boolean(fieldErrs.password)}
                aria-describedby={fieldErrs.password ? "password-err" : undefined}
              />
              {fieldErrs.password && <p id="password-err" role="alert" className="mt-1 text-xs text-red-600">{fieldErrs.password}</p>}
            </div>
            {error && <ErrorBanner message={error} />}
            <Button type="submit" size="lg" className="w-full" disabled={busy || inputInvalid}>
              {busy ? "..." : t("signIn", lang)}
            </Button>
            {inputInvalid && !busy && (
              <p className="text-center text-[11px] text-stone-500">{t("fixErrorsNote", lang)}</p>
            )}
            <p className="text-center text-sm text-stone-600">
              {t("noAccount", lang)}{" "}
              <Link to="/register" className="font-semibold text-green-700 hover:underline">→</Link>
            </p>
            {import.meta.env.DEV && (
              <div className="rounded-md bg-stone-50 px-3 py-2 text-center text-[11px] leading-relaxed text-stone-500">
                <p className="font-semibold uppercase tracking-wide">{t("demoCredentialsTitle", lang)}</p>
                <p>{t("demoCredentialsBody", lang)}</p>
              </div>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
