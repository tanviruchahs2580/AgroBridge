import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Bell, Bot, Coins, Compass, Home as HomeIcon, LogOut, ShoppingCart, Tractor, TriangleAlert, Wallet as WalletIcon, Wrench } from "lucide-react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { t } from "./lib/i18n.js";
import type { DictKey, Lang } from "./lib/i18n.js";
import { isOnline, onOnlineStatusChange, wakeBackend } from "./lib/api.js";
import { flushAll, size as queuedMutations, subscribe as subscribeQueue } from "./lib/offlineQueue.js";
import { track } from "./lib/analytics.js";
import { BottomNav, Sidebar, Skeleton, useToast } from "./components/ui.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { PageTransition } from "./components/PageTransition.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { Splash } from "./components/Splash.jsx";
import { onEnqueue as onOfflineEnqueue } from "./lib/offlineQueue.js";
import { motion } from "framer-motion";
import Login from "./pages/Login";

// STEP 42: Login remains eager (critical path); all other pages are code-split via lazy + Suspense.
// Fixed: remove .jsx extension — Vite resolves .tsx correctly for dev & preview (prevents "Failed to fetch" on LAN/preview)
const Register = lazy(() => import("./pages/Register"));
const Home = lazy(() => import("./pages/Home"));
const MyFarm = lazy(() => import("./pages/MyFarm"));
const Market = lazy(() => import("./pages/Market"));
const Services = lazy(() => import("./pages/Services"));
const SellCrop = lazy(() => import("./pages/SellCrop"));
const WalletPage = lazy(() => import("./pages/Wallet"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Advisor = lazy(() => import("./pages/Advisor"));
const AdminPanel = lazy(() => import("./pages/Admin"));

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
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-20 w-full" />
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
        <Compass className="h-10 w-10 text-stone-400" aria-hidden />
        <h1 className="text-lg font-bold text-stone-800">{t("notFoundTitle", lang)}</h1>
        <p className="max-w-sm text-sm text-stone-600">{t("notFoundBody", lang)}</p>
        <Link to="/" className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-green-700 px-4 py-2 font-semibold text-white hover:bg-green-800">
          {t("backHome", lang)}
        </Link>
      </div>
    </main>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { session, logout, setLang } = useSession();
  const location = useLocation();
  const online = useIsOnline();
  const queued = useQueuedCount();
  // Preserve the intended destination: the session hydrates asynchronously, so a
  // cold load of a deep link passes through /login — hand the path back so
  // ReverseGuard returns the user to where they were heading.
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  const lang = session.lang;

  const primaryNav: { to: string; key: Parameters<typeof t>[0]; icon: ReactNode }[] = [
    { to: "/", key: "home", icon: <HomeIcon className="h-5 w-5" /> },
    { to: "/farm", key: "myFarm", icon: <Tractor className="h-5 w-5" /> },
    { to: "/advisor", key: "aiAgent", icon: <Bot className="h-5 w-5" /> },
    { to: "/market", key: "market", icon: <ShoppingCart className="h-5 w-5" /> },
    { to: "/wallet", key: "wallet", icon: <WalletIcon className="h-5 w-5" /> },
  ];
  const secondaryNav: { to: string; key: Parameters<typeof t>[0]; icon: ReactNode }[] = [
    { to: "/services", key: "services", icon: <Wrench className="h-5 w-5" /> },
    { to: "/sell", key: "sellCrop", icon: <Coins className="h-5 w-5" /> },
    { to: "/notifications", key: "notifications", icon: <Bell className="h-5 w-5" /> },
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
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[80] focus:min-h-[44px] focus:rounded-lg focus:bg-green-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
      >
        {t("skipToContent", lang)}
      </a>
      <header className="sticky top-0 z-10 bg-[#14532d] shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15 text-lg leading-none">🌾</span>
            <div className="font-bold text-white">{t("appName", lang)}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={lang === "bn" ? "Switch to English" : "বাংলায় ফিরুন"}
              onClick={() => setLang(lang === "bn" ? "en" : "bn")}
              className="inline-flex min-h-[36px] items-center rounded-lg border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {lang === "bn" ? "EN" : "বাং"}
            </button>
            {(session.role === "ADMIN" || session.role === "SUPER_ADMIN") && (
              <NavLink to="/admin" className="hidden sm:inline-flex min-h-[36px] items-center rounded-lg border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
                {t("admin", lang)}
              </NavLink>
            )}
            <button onClick={logout} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <LogOut className="h-4 w-4" aria-hidden /> {t("logout", lang)}
            </button>
          </div>
        </div>
      </header>
      <TopBar />
      {!online && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          role="status"
          aria-live="polite"
          className="bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold text-amber-800 motion-reduce:transition-none"
        >
          <TriangleAlert className="mr-1 inline h-4 w-4" aria-hidden /> {t("offlineBanner", lang)}
          {queued > 0 && <span aria-live="polite" aria-atomic="true" className="ml-1">({queued})</span>}
        </motion.div>
      )}
      <div className="mx-auto flex max-w-6xl">
        <Sidebar items={sidebarItems} />
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 pb-24 outline-none md:pb-5">{children}</main>
      </div>
      <BottomNav items={bottomItems} />
    </div>
  );
}

export default function App() {
  const { session, loading } = useSession();
  const location = useLocation();
  const lang: Lang = session?.lang ?? "bn";
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window !== "undefined" && (navigator as unknown as { webdriver?: boolean }).webdriver) return false;
    // Cold start only: once the splash has played this browser session, deep links
    // and reloads must not replay it (flag is set in onDone below).
    try {
      if (sessionStorage.getItem("agro_splash_done") === "1") return false;
    } catch {
      // ignore storage errors (private mode / quota)
    }
    return true;
  });

  // Offline mutation queue: flush at boot and whenever connectivity returns.
  useEffect(() => {
    wakeBackend(); // warm the idle-spun-down hosted API during splash/login
    void flushAll();
    return onOnlineStatusChange((online) => {
      if (online) void flushAll();
    });
  }, []);

  // STEP 55: offline toast when a mutation is queued
  const toast = useToast();
  useEffect(() => onOfflineEnqueue(() => toast.info("অফলাইন — পরে পাঠানো হবে")), [toast]);
  // Also handle window event for cases where onEnqueue fires before React mount
  useEffect(() => {
    const h = () => toast.info("অফলাইন — পরে পাঠানো হবে");
    window.addEventListener("agrobridge:offline-queued", h as EventListener);
    return () => window.removeEventListener("agrobridge:offline-queued", h as EventListener);
  }, [toast]);

  // Route-view analytics + bilingual document.title + move focus to main on navigation.
  useEffect(() => {
    track("route_view", { path: location.pathname });
    const key = ROUTE_TITLES[location.pathname];
    document.title = key
      ? `${t(key, lang)} · ${t("appName", lang)}`
      : `${t("appName", lang)} — ${t("tagline", lang)}`;
    // Move focus to the main landmark so screen-reader users land on page content.
    const mainEl = document.getElementById("main");
    if (mainEl && document.activeElement !== mainEl) {
      (mainEl as HTMLElement).focus();
    }
  }, [location.pathname, lang]);

  const splashOverlay = showSplash ? (
    <Splash
      onDone={() => {
        setShowSplash(false);
        try {
          sessionStorage.setItem("agro_splash_done", "1");
        } catch {
          // ignore storage errors (private mode / quota)
        }
      }}
    />
  ) : null;

  if (loading && !showSplash) {
    return <div className="flex min-h-screen items-center justify-center text-green-700">{t("loading", "bn")}</div>;
  }

  return (
    <>
      {splashOverlay}
      <Routes>
        <Route path="/login" element={<ReverseGuard><PageTransition><Login /></PageTransition></ReverseGuard>} />
        <Route path="/register" element={<ReverseGuard><Suspense fallback={<PageFallback />}><PageTransition><Register /></PageTransition></Suspense></ReverseGuard>} />
        <Route path="/" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><Home /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="/farm" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><MyFarm /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="/advisor" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><Advisor /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="/market" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><Market /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="/services" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><Services /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="/sell" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><SellCrop /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="/wallet" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><WalletPage /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="/notifications" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><Notifications /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="/admin" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><AdminPanel /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="/onboarding" element={<Shell><ErrorBoundary key={location.pathname} lang={lang}><Suspense fallback={<PageFallback />}><PageTransition><Onboarding /></PageTransition></Suspense></ErrorBoundary></Shell>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
