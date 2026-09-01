import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setTokens } from "../lib/api.js";
import { track } from "../lib/analytics.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import { Sprout, Phone, Lock, Eye, EyeOff } from "lucide-react";
import { ErrorBanner } from "../components/ui.jsx";
import { BD_PHONE_RE, mapError } from "../lib/errors-ui.js";

export default function Login() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
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
    <div className="relative flex min-h-screen flex-col items-center bg-[#F8FAF5] px-4 pb-6 pt-6 sm:px-6 overflow-hidden">
      {/* Background — exact rice field as screenshot, blurred, light overlay */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <img
          src="https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1400&q=80"
          alt=""
          className="h-full w-full object-cover object-center opacity-[0.32] blur-[1px]"
          style={{ filter: "brightness(1.08) contrast(0.92) saturate(1.05)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white via-white/85 to-[#F0FDF4]/90" />
        <div className="absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-[#DCFCE7]/50 via-[#F0FDF4]/30 to-transparent" />
      </div>

      {/* Logo — exact as screenshot */}
      <div className="relative flex flex-col items-center text-center">
        <span className="flex h-[72px] w-[72px] items-center justify-center rounded-[18px] bg-gradient-to-b from-[#4ADE80] to-[#15803D] shadow-[0_10px_24px_rgba(21,128,61,0.28)] ring-1 ring-black/5" aria-hidden>
          <Sprout className="h-9 w-9 text-white" strokeWidth={2} />
        </span>
        <h1 className="mt-3 text-[30px] font-extrabold leading-none tracking-[-0.02em] text-[#0F172A]" style={{ fontFamily: "'Hind Siliguri', system-ui, sans-serif" }}>
          এগ্রো ব্রিজ
        </h1>
        <p className="mt-1 text-[12px] font-medium tracking-[0.02em] text-[#64748B]">স্মার্ট কৃষি, সমৃদ্ধ ভবিষ্যৎ</p>
      </div>

      {/* Card — exact as screenshot */}
      <div className="relative mt-6 w-full max-w-md rounded-[20px] border border-black/[0.04] bg-white p-5 shadow-[0_20px_50px_rgba(0,0,0,0.12)] sm:p-6">
        <div className="text-center">
          <h2 className="text-[19px] font-extrabold leading-6 text-[#0F172A]">স্বাগতম</h2>
          <p className="mt-1 text-[13px] font-medium text-[#64748B]">আপনার অ্যাকাউন্টে লগইন করুন</p>
        </div>

        <form onSubmit={submit} noValidate className="mt-5 space-y-3.5">
          <div>
            <div className={`flex items-center gap-3 rounded-[14px] border bg-[#F8FAF5]/50 px-3 py-2.5 shadow-sm focus-within:ring-2 ${fieldErrs.phone ? "border-red-300 focus-within:border-red-400 focus-within:ring-red-100" : "border-[#E2E8F0] focus-within:border-[#15803D] focus-within:ring-[#DCFCE7]"}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#DCFCE7] text-[#15803D] ring-1 ring-[#BBF7D0]" aria-hidden>
                <Phone className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <label htmlFor="phone" className="block text-[12px] font-semibold leading-none text-[#0F172A]">
                  মোবাইল নম্বর
                </label>
                <input
                  id="phone"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setFieldErrs((p) => ({ ...p, phone: undefined })); }}
                  onBlur={() => { if (phone.trim() && !BD_PHONE_RE.test(phone.trim())) setFieldErrs((p) => ({ ...p, phone: t("errPhoneInvalid", lang) })); }}
                  placeholder="01XXXXXXXXXX"
                  className="mt-1 h-5 w-full bg-transparent p-0 text-[14px] font-medium leading-none text-[#0F172A] placeholder:text-[#6B7280] focus:outline-none"
                  aria-invalid={Boolean(fieldErrs.phone)}
                  aria-describedby={fieldErrs.phone ? "phone-err" : undefined}
                />
              </div>
            </div>
            {fieldErrs.phone && <p id="phone-err" role="alert" className="mt-1 text-xs font-medium text-red-600">{fieldErrs.phone}</p>}
          </div>

          <div>
            <div className={`flex items-center gap-3 rounded-[14px] border bg-[#F8FAF5]/50 px-3 py-2.5 shadow-sm focus-within:ring-2 ${fieldErrs.password ? "border-red-300 focus-within:border-red-400 focus-within:ring-red-100" : "border-[#E2E8F0] focus-within:border-[#15803D] focus-within:ring-[#DCFCE7]"}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#DCFCE7] text-[#15803D] ring-1 ring-[#BBF7D0]" aria-hidden>
                <Lock className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <label htmlFor="password" className="block text-[12px] font-semibold leading-none text-[#0F172A]">
                  পাসওয়ার্ড
                </label>
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setFieldErrs((p) => ({ ...p, password: undefined })); }}
                  onBlur={() => { if (password && password.length < 8) setFieldErrs((p) => ({ ...p, password: t("errWeakPassword", lang) })); }}
                  placeholder="••••••••"
                  className="mt-1 h-5 w-full bg-transparent p-0 pr-1 text-[14px] font-medium leading-none text-[#0F172A] placeholder:tracking-[0.25em] placeholder:text-[#6B7280] focus:outline-none"
                  aria-invalid={Boolean(fieldErrs.password)}
                  aria-describedby={fieldErrs.password ? "password-err" : undefined}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#64748B] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
                aria-label={showPass ? "Hide password" : "Show password"}
              >
                {showPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {fieldErrs.password && <p id="password-err" role="alert" className="mt-1 text-xs font-medium text-red-600">{fieldErrs.password}</p>}
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex cursor-pointer items-center gap-2">
              <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border-2 ${remember ? "border-[#15803D] bg-[#15803D] text-white" : "border-[#CBD5E1] bg-white"}`}>
                {remember && <span className="text-[11px] leading-none">✓</span>}
              </span>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="sr-only" />
              <span className="text-[13px] font-medium text-[#334155]">আমাকে মনে রাখুন</span>
            </label>
            <Link to="#" onClick={(e) => e.preventDefault()} className="text-[13px] font-medium text-[#15803D] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] rounded">
              পাসওয়ার্ড ভুলে গেছেন?
            </Link>
          </div>

          {error && <ErrorBanner message={error} />}

          <button
            type="submit"
            disabled={busy || inputInvalid}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[12px] bg-gradient-to-b from-[#22C55E] to-[#16A34A] px-4 py-3 text-[16px] font-bold text-white shadow-[0_8px_20px_rgba(34,197,94,0.32)] transition hover:from-[#16A34A] hover:to-[#15803D] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "..." : "প্রবেশ করুন"} <span aria-hidden>→</span>
          </button>

          {inputInvalid && !busy && <p className="text-center text-[11px] text-[#64748B]">{t("fixErrorsNote", lang)}</p>}

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-[#E2E8F0]" aria-hidden />
            <span className="text-[13px] font-medium text-[#57534E]">অথবা</span>
            <span className="h-px flex-1 bg-[#E2E5E4]" aria-hidden />
          </div>

          <button
            type="button"
            onClick={() => alert(lang === "bn" ? "Google সাইন-ইন শীঘ্রই আসছে" : "Google sign-in coming soon")}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[12px] border border-[#E2E8F0] bg-white px-4 py-2.5 text-[14px] font-semibold text-[#0F172A] shadow-sm transition hover:bg-[#F8FAF5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white">
              <span className="bg-gradient-to-r from-[#4285F4] via-[#34A853] to-[#EA4335] bg-clip-text text-[18px] font-extrabold text-transparent">G</span>
            </span>
            <span className="text-[#1A1F1C]">Google <span className="font-normal text-[#475569]">দিয়ে চালিয়ে যান</span></span>
          </button>
        </form>
      </div>

      <p className="relative mt-4 text-center text-[13px] font-medium">
        <span className="text-[#475569]">অ্যাকাউন্ট নেই? </span>
        <Link to="/register" className="inline-flex items-center gap-1 font-bold text-[#15803D] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] rounded">
          রেজিস্ট্রেশন করুন <span aria-hidden>›</span>
        </Link>
      </p>

      {import.meta.env.DEV && (
        <div className="relative mt-3 max-w-md rounded-[12px] bg-white/90 px-3 py-2 text-center text-[11px] leading-relaxed text-[#475569] shadow-sm backdrop-blur">
          <p className="font-semibold uppercase tracking-wide">{t("demoCredentialsTitle", lang)}</p>
          <p>{t("demoCredentialsBody", lang)}</p>
        </div>
      )}
    </div>
  );
}
