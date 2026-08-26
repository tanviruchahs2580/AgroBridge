import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { t } from "./lib/i18n.js";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Home from "./pages/Home.jsx";
import MyFarm from "./pages/MyFarm.jsx";
import Advisor from "./pages/Advisor.jsx";
import Market from "./pages/Market.jsx";
import Services from "./pages/Services.jsx";
import SellCrop from "./pages/SellCrop.jsx";
import WalletPage from "./pages/Wallet.jsx";
import Notifications from "./pages/Notifications.jsx";
import AdminPanel from "./pages/Admin.jsx";

function Shell({ children }: { children: React.ReactNode }) {
  const { session, logout, setLang } = useSession();
  if (!session) return <Navigate to="/login" replace />;
  const lang = session.lang;

  const navItems: { to: string; key: Parameters<typeof t>[0] }[] = [
    { to: "/", key: "home" },
    { to: "/farm", key: "myFarm" },
    { to: "/advisor", key: "aiAgent" },
    { to: "/market", key: "market" },
    { to: "/services", key: "services" },
    { to: "/sell", key: "sellCrop" },
    { to: "/notifications", key: "notifications" },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌾</span>
            <div>
              <div className="font-bold text-green-800">{t("appName", lang)}</div>
              <div className="hidden text-[10px] text-stone-500 sm:block">{t("tagline", lang)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={lang === "bn" ? "Switch to English" : "বাংলায় ফিরুন"} onClick={() => setLang(lang === "bn" ? "en" : "bn")} className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-stone-600 hover:bg-stone-100">
              {lang === "bn" ? "EN" : "বাং"}
            </button>
            {(session.role === "ADMIN" || session.role === "SUPER_ADMIN") && (
              <NavLink to="/admin" className="btn-outline !py-1.5 !text-xs">{t("admin", lang)}</NavLink>
            )}
            <button onClick={logout} className="text-sm font-medium text-stone-500 hover:text-red-600">{t("logout", lang)}</button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2 text-sm">
          {navItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 font-medium ${isActive ? "bg-green-700 text-white" : "text-stone-600 hover:bg-green-50"}`
              }
            >
              {t(n.key, lang)}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
    </div>
  );
}

export default function App() {
  const { loading } = useSession();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-green-700">{t("loading", "bn")}</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Shell><Home /></Shell>} />
      <Route path="/farm" element={<Shell><MyFarm /></Shell>} />
      <Route path="/advisor" element={<Shell><Advisor /></Shell>} />
      <Route path="/market" element={<Shell><Market /></Shell>} />
      <Route path="/services" element={<Shell><Services /></Shell>} />
      <Route path="/sell" element={<Shell><SellCrop /></Shell>} />
      <Route path="/wallet" element={<Shell><WalletPage /></Shell>} />
      <Route path="/notifications" element={<Shell><Notifications /></Shell>} />
      <Route path="/admin" element={<Shell><AdminPanel /></Shell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
