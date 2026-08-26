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
import Onboarding from "./pages/Onboarding.jsx";
import { BottomNav, Sidebar } from "./components/ui.jsx";

function Shell({ children }: { children: React.ReactNode }) {
  const { session, logout, setLang } = useSession();
  if (!session) return <Navigate to="/login" replace />;
  const lang = session.lang;

  const primaryNav: { to: string; key: Parameters<typeof t>[0]; icon: string }[] = [
    { to: "/", key: "home", icon: "🏠" },
    { to: "/farm", key: "myFarm", icon: "🚜" },
    { to: "/advisor", key: "aiAgent", icon: "🤖" },
    { to: "/market", key: "market", icon: "🛒" },
    { to: "/wallet", key: "wallet", icon: "👛" },
  ];
  const secondaryNav: { to: string; key: Parameters<typeof t>[0]; icon: string }[] = [
    { to: "/services", key: "services", icon: "🔧" },
    { to: "/sell", key: "sellCrop", icon: "💰" },
    { to: "/notifications", key: "notifications", icon: "🔔" },
  ];

  const bottomItems = primaryNav.map((n) => ({ to: n.to, label: t(n.key, lang), icon: n.icon }));
  const sidebarItems = [...primaryNav, ...secondaryNav].map((n) => ({ to: n.to, label: t(n.key, lang), icon: n.icon }));

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden>🌾</span>
            <div>
              <div className="font-bold text-green-800">{t("appName", lang)}</div>
              <div className="hidden text-[10px] text-stone-500 sm:block">{t("tagline", lang)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={lang === "bn" ? "Switch to English" : "বাংলায় ফিরুন"} onClick={() => setLang(lang === "bn" ? "en" : "bn")} className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
              {lang === "bn" ? "EN" : "বাং"}
            </button>
            {(session.role === "ADMIN" || session.role === "SUPER_ADMIN") && (
              <NavLink to="/admin" className="btn-outline !py-1.5 !text-xs">{t("admin", lang)}</NavLink>
            )}
            <button onClick={logout} className="text-sm font-medium text-stone-500 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">{t("logout", lang)}</button>
          </div>
        </div>
        {/* Legacy top nav hidden when new shell active (md+) — keep for no-JS fallback */}
        <nav className="mx-auto hidden max-w-6xl gap-1 overflow-x-auto px-2 pb-2 text-sm md:hidden">
          {[...primaryNav, ...secondaryNav].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${isActive ? "bg-green-700 text-white" : "text-stone-600 hover:bg-green-50"}`
              }
            >
              {t(n.key, lang)}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="mx-auto flex max-w-6xl">
        <Sidebar items={sidebarItems} />
        <main className="min-w-0 flex-1 px-4 py-5 pb-20 md:pb-5">{children}</main>
      </div>
      <BottomNav items={bottomItems} />
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
      <Route path="/onboarding" element={<Shell><Onboarding /></Shell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
