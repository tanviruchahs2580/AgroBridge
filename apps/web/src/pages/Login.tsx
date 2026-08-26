import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setTokens } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

export default function Login() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { refresh } = useSession();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ accessToken: string; refreshToken: string }>("POST", "/auth/login", { phone, password });
      setTokens(data.accessToken, data.refreshToken);
      await refresh();
      nav("/");
    } catch (err) {
      setError((err as Error).message || t("errorGeneric", "bn"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-green-50 to-stone-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-4xl">🌾</div>
          <h1 className="mt-2 text-2xl font-bold text-green-800">{t("appName", "bn")}</h1>
          <p className="text-xs text-stone-500">{t("tagline", "bn")}</p>
        </div>
        <form onSubmit={submit} className="card space-y-4">
          <div>
            <label className="label" htmlFor="phone">{t("phone", "bn")}</label>
            <input id="phone" className="input" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01712345678" required />
          </div>
          <div>
            <label className="label" htmlFor="password">{t("password", "bn")}</label>
            <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full !py-3 text-base" disabled={busy}>{busy ? "..." : t("login", "bn")}</button>
          <p className="text-center text-sm text-stone-500">
            {t("register", "bn")}? <Link to="/register" className="font-semibold text-green-700 hover:underline">→</Link>
          </p>
          <p className="rounded-md bg-stone-50 px-3 py-2 text-center text-[11px] leading-relaxed text-stone-400">
            ডেমো: কৃষক 01700000002 / Demo@1234 · অ্যাডমিন 01700000001 / Demo@1234
          </p>
        </form>
      </div>
    </div>
  );
}
