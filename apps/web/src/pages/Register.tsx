import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setTokens } from "../lib/api.js";
import { track } from "../lib/analytics.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import { Button, Card, ErrorBanner, Input, Label } from "../components/ui.jsx";
import { BD_PHONE_RE, mapError } from "../lib/errors-ui.js";

export default function Register() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [fullName, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [langPref, setLangPref] = useState<"bn" | "en">("bn");
  const [fieldErrs, setFieldErrs] = useState<{ fullName?: string; phone?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { refresh } = useSession();

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-green-50 to-stone-100 px-2 sm:px-4">
      <Card className="w-full max-w-md min-w-0 overflow-hidden">
        <form onSubmit={submit} noValidate className="space-y-4">
          <h1 className="text-xl font-bold text-green-800">{t("registerTitle", lang)}</h1>
          <div>
            <Label htmlFor="name">{t("fullName", lang)}</Label>
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
            {fieldErrs.fullName && <p id="name-err" role="alert" className="mt-1 text-xs text-red-600">{fieldErrs.fullName}</p>}
          </div>
          <div>
            <Label htmlFor="rphone">{t("phone", lang)}</Label>
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
            {fieldErrs.phone && <p id="rphone-err" role="alert" className="mt-1 text-xs text-red-600">{fieldErrs.phone}</p>}
          </div>
          <div>
            <Label htmlFor="rpass">
              {t("password", lang)} <span className="text-xs font-normal text-stone-500">{t("passwordHint", lang)}</span>
            </Label>
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
            {fieldErrs.password && <p id="rpass-err" role="alert" className="mt-1 text-xs text-red-600">{fieldErrs.password}</p>}
          </div>
          <div>
            <Label>{t("langSelectLabel", lang)}</Label>
            <div className="flex gap-2" role="radiogroup" aria-label={t("langSelectLabel", lang)}>
              {(["bn", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={langPref === l}
                  onClick={() => setLangPref(l)}
                  className={`min-h-[44px] flex-1 rounded-lg border py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
                    langPref === l ? "border-green-700 bg-green-50 text-green-800" : "border-stone-300 text-stone-600"
                  }`}
                >
                  {l === "bn" ? "বাংলা" : "English"}
                </button>
              ))}
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <Button type="submit" size="lg" className="w-full" disabled={busy || inputInvalid}>
            {busy ? "..." : t("signUp", lang)}
          </Button>
          {inputInvalid && !busy && (
            <p className="text-center text-[11px] text-stone-500">{t("fixErrorsNote", lang)}</p>
          )}
          <p className="text-center text-sm text-stone-600">
            {t("haveAccount", lang)}{" "}
            <Link to="/login" className="font-semibold text-green-700 hover:underline">→</Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
