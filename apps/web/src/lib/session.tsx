import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, setUnauthorizedHandler } from "./api";
import { getTokens, clearTokens as smClearTokens } from "./sessionManager";
import { track } from "./analytics";
import { t } from "./i18n";
import { useToast } from "../components/ui";

export interface Session {
  userId: string;
  fullName: string;
  role: string;
  lang: "bn" | "en";
  dark: boolean;
  /** Profile district, used to localise weather advice (null until the user sets one). */
  district: string | null;
}

interface Ctx {
  session: Session | null;
  loading: boolean;
  dark: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  /**
   * Ends the local session WITHOUT calling the server (no /auth/logout).
   * Used after self-deletion: the account is gone, its tokens are already
   * revoked server-side, and asking the deleted credential to log itself out
   * produced a 401 that the transport reported as "session expired" — a
   * misleading toast on the very screen where the user just deleted the
   * account (found by the live acceptance run 2026-10-19).
   */
  endSession: () => void;
  setLang: (l: "bn" | "en") => void;
  toggleDark: () => void;
}

const SessionCtx = createContext<Ctx>({ session: null, loading: true, dark: false, refresh: async () => {}, logout: () => {}, endSession: () => {}, setLang: () => {}, toggleDark: () => {} });

/** Apply the theme to <html> + browser chrome colors. Single source of truth
 *  for the DOM side-effects so React and the index.html boot script agree. */
export function applyTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0b2b1a" : "#166534");
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.dataset.theme === "dark";
  });
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // Dark mode — the boot script in index.html already set data-theme before
  // React mounted; keep the context state and browser-chrome colors in sync
  // and follow live OS preference changes while the user has no explicit choice.
  useEffect(() => {
    applyTheme(dark);
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const onChange = (e: MediaQueryListEvent) => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem("agro_dark_mode");
      } catch {
        /* ignore */
      }
      if (stored !== null) return; // explicit user choice wins over OS changes
      setDark(e.matches);
    };
    mq?.addEventListener?.("change", onChange);
    return () => mq?.removeEventListener?.("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (!getTokens().accessToken) {
      setSession(null);
      setLoading(false);
      return;
    }
    // A boot-time network failure or transient 5xx must NOT destroy valid
    // tokens — that would log an offline user out and defeat the offline
    // story. Only a definitive 401 (the api layer already did its refresh
    // attempt) clears the session. The api layer retries GETs on network
    // errors and 5xx before we ever see the throw.
    try {
      const me = await api<{ id: string; fullName: string; role: string; langPref: "bn" | "en"; farmerProfile?: { district?: string | null } | null }>("GET", "/auth/me");
      setSession({ userId: me.id, fullName: me.fullName, role: me.role, lang: me.langPref, dark, district: me.farmerProfile?.district?.trim() || null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        smClearTokens();
      }
      setSession(null); // tokens survive network failures; session restores next boot
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Final-401 hook from the http layer: clear session, notify, send to /login
  // keeping the current path so login can return the user.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      smClearTokens();
      setSession(null);
      track("session_expired");
      toast.error(t("sessionExpired", session?.lang ?? "bn"));
      if (location.pathname !== "/login" && location.pathname !== "/register") {
        navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
      }
    });
    return () => setUnauthorizedHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, session?.lang]);

  // Keep <html lang> in sync with the active UI language.
  useEffect(() => {
    document.documentElement.lang = session?.lang === "en" ? "en" : "bn";
  }, [session?.lang]);

  function logout() {
    void api("POST", "/auth/logout", {}).catch(() => undefined); // revoke server-side; network errors are non-fatal
    smClearTokens();
    setSession(null);
  }

  function endSession() {
    smClearTokens();
    setSession(null);
  }

  async function setLang(l: "bn" | "en") {
    setSession((s) => (s ? { ...s, lang: l } : s));
    document.documentElement.lang = l;
    track("language_switch", { to: l });
    try {
      await api("PATCH", "/auth/me", { langPref: l });
    } catch {
      /* keep UI language even if persist fails */
    }
  }

  function toggleDark() {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.add("theme-transition");
      applyTheme(next);
      window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 300);
      try {
        localStorage.setItem("agro_dark_mode", next ? "true" : "false");
      } catch {
        /* ignore storage errors */
      }
      track("dark_mode_toggle", { mode: next ? "dark" : "light" });
      return next;
    });
  }

  return <SessionCtx.Provider value={{ session, loading, dark, refresh, logout, endSession, setLang, toggleDark }}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  return useContext(SessionCtx);
}
