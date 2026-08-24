import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, setTokens } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

export default function Register() {
  const [fullName, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [langPref, setLangPref] = useState<"bn" | "en">("bn");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { refresh } = useSession();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ accessToken: string; refreshToken: string }>("POST", "/auth/register", {
        fullName, phone, password, langPref,
      });
      setTokens(data.accessToken, data.refreshToken);
      await refresh();
      nav("/farm");
    } catch (err) {
      const anyErr = err as { details?: { path: string; message: string }[] };
      setError(anyErr.details?.map((d) => d.message).join(", ") || (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-green-50 to-stone-100 px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold text-green-800">{t("register", "bn")}</h1>
        <div>
          <label className="label" htmlFor="name">{t("fullName", "bn")}</label>
          <input id="name" className="input" value={fullName} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </div>
        <div>
          <label className="label" htmlFor="rphone">{t("phone", "bn")}</label>
          <input id="rphone" className="input" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" required pattern="01[3-9][0-9]{8}" />
        </div>
        <div>
          <label className="label" htmlFor="rpass">{t("password", "bn")} (৮+ অক্ষর)</label>
          <input id="rpass" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        <div>
          <span className="label">ভাষা / Language</span>
          <div className="flex gap-2">
            {(["bn", "en"] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLangPref(l)}
                className={`flex-1 rounded-lg border py-2 text-sm font-semibold ${langPref === l ? "border-green-700 bg-green-50 text-green-800" : "border-stone-300 text-stone-500"}`}>
                {l === "bn" ? "বাংলা" : "English"}
              </button>
            ))}
          </div>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? "..." : t("register", "bn")}</button>
        <p className="text-center text-sm text-stone-500">
          <Link to="/login" className="font-semibold text-green-700 hover:underline">{t("login", "bn")} →</Link>
        </p>
      </form>
    </div>
  );
}
