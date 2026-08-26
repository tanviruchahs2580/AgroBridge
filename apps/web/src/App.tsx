import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { t } from "./lib/i18n.js";
import type { DictKey, Lang } from "./lib/i18n.js";
import { isOnline, onOnlineStatusChange } from "./lib/api.js";
import { flushAll, size as queuedMutations, subscribe as subscribeQueue } from "./lib/offlineQueue.js";
import { track } from "./lib/analytics.js";
import { BottomNav, Sidebar, Skeleton } from "./components/ui.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Home from "./pages/Home.jsx";
import MyFarm from "./pages/MyFarm.jsx";
import Market from "./pages/Market.jsx";
import Services from "./pages/Services.jsx";
import SellCrop from "./pages/SellCrop.jsx";
import WalletPage from "./pages/Wallet.jsx";
import Notifications from "./pages/Notifications.jsx";
import Onboarding from "./pages/Onboarding.jsx";

// Heavy/admin surfaces are code-split.
const Advisor = lazy(() => import("./pages/Advisor.jsx"));
const AdminPanel = lazy(() => import("./pages/Admin.jsx"));

const ROUTE_TITLES: Record<string, DictKey> = {
  "/": "home",
  "/farm": "myFarm",
  "/advisor": "aiAgent",
  "/market": "market",
  "/services": "services",
  "/sell": "sellCrop",
  "/wallet": "wallet",
  "/notifications": "notifications",
  "/admin": "admin",
  "/onboarding": "onboarding",
  "/login": "login",
  "/register": "register",
};

/** Live connectivity state driven by navigator online/offline events. */
function useIsOnline(): boolean {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => onOnlineStatusChange(setOnline), []);
  return online;
}

/** Pending offline mutation count for UI badges. */
function useQueuedCount(): number {
  const [count, setCount] = useState(queuedMutations());
  useEffect(() => subscribeQueue(setCount), []);
  return count;
}

/** Authenticated users never see /login|/register — bounce back to where they came from. */
function ReverseGuard({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const location = useLocation();
  if (!session) return <>{children}</>;
  const from = (location.state as { from?: string } | null)?.from;
  return <Navigate to={from && from !== "/login" && from !== "/register" ? from : "/"} replace />;
}

function PageFallback() {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm space-y-3">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function NotFound() {
  const { session } = useSession();
  const lang: Lang = session?.lang ?? "bn";
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 py-10 text-center shadow-sm">
        <div aria-hidden className="text-4xl">🧭</div>
        <h1 className="text-lg font-bold text-stone-800">{t("notFoundTitle", lang)}</h1>
        <p className="max-w-sm text-sm text-stone-500">{t("notFoundBody", lang)}</p>
        <Link to="/" className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-green-700 px-4 py-2 font-semibold text-white hover:bg-green-800">
          {t("backHome", lang)}
        </Link>
      </div>
    </main>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { session, logout, setLang } = useSession();
  const online = useIsOnline();
  const queued = useQueuedCount();
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

  const bottomItems = primaryNav.map((n) => ({
    to: n.to,
    label: t(n.key, lang),
    icon: n.icon,
    badge: n.to === "/wallet" && queued > 0,
  }));
  const sidebarItems = [...primaryNav, ...secondaryNav].map((n) => ({ to: n.to, label: t(n.key, lang), icon: n.icon }));

  return (
    <div className="min-h-screen bg-stone-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[80] focus:min-h-[44px] focus:rounded-lg focus:bg-green-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-200"
      >
        {t("skipToContent", lang)}
      </a>
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
            <button
              type="button"
              aria-label={lang === "bn" ? "Switch to English" : "বাংলায় ফিরুন"}
              onClick={() => setLang(lang === "bn" ? "en" : "bn")}
              className="touch-target !min-h-0 rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
            >
              {lang === "bn" ? "EN" : "বাং"}
            </button>
            {(session.role === "ADMIN" || session.role === "SUPER_ADMIN") && (
              <NavLink to="/admin" className="inline-flex min-h-[36px] items-center rounded-lg border border-green-700 px-3 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-50">
                {t("admin", lang)}
              </NavLink>
            )}
            <button onClick={logout} className="min-h-[44px] text-sm font-medium text-stone-500 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">{t("logout", lang)}</button>
          </div>
        </div>
      </header>
      {!online && (
        <div role="status" className="bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold text-amber-800">
          ⚠ {t("offlineBanner", lang)}
          {queued > 0 && <span className="ml-1">({queued})</span>}
        </div>
      )}
      <div className="mx-auto flex max-w-6xl">
        <Sidebar items={sidebarItems} />
        <main id="main" className="min-w-0 flex-1 px-4 py-5 pb-20 md:pb-5">{children}</main>
      </div>
      <BottomNav items={bottomItems} />
    </div>
  );
}

export default function App() {
  const { session, loading } = useSession();
  const location = useLocation();
  const lang: Lang = session?.lang ?? "bn";

  // Offline mutation queue: flush at boot and whenever connectivity returns.
  useEffect(() => {
    void flushAll();
    return onOnlineStatusChange((online) => {
      if (online) void flushAll();
    });
  }, []);

  // Route-view analytics + bilingual document.title.
  useEffect(() => {
    track("route_view", { path: location.pathname });
    const key = ROUTE_TITLES[location.pathname];
    document.title = key
      ? `${t(key, lang)} · ${t("appName", lang)}`
      : `${t("appName", lang)} — ${t("tagline", lang)}`;
  }, [location.pathname, lang]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-green-700">{t("loading", "bn")}</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={<ReverseGuard><Login /></ReverseGuard>} />
      <Route path="/register" element={<ReverseGuard><Register /></ReverseGuard>} />
      <Route path="/" element={<Shell><Home /></Shell>} />
      <Route path="/farm" element={<Shell><MyFarm /></Shell>} />
      <Route path="/advisor" element={<Shell><Suspense fallback={<PageFallback />}><Advisor /></Suspense></Shell>} />
      <Route path="/market" element={<Shell><Market /></Shell>} />
      <Route path="/services" element={<Shell><Services /></Shell>} />
      <Route path="/sell" element={<Shell><SellCrop /></Shell>} />
      <Route path="/wallet" element={<Shell><WalletPage /></Shell>} />
      <Route path="/notifications" element={<Shell><Notifications /></Shell>} />
      <Route path="/admin" element={<Shell><Suspense fallback={<PageFallback />}><AdminPanel /></Suspense></Shell>} />
      <Route path="/onboarding" element={<Shell><Onboarding /></Shell>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
