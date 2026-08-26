import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, clearTokens, setUnauthorizedHandler } from "./api.js";
import { identify, track } from "./analytics.js";
import { t } from "./i18n.js";
import { useToast } from "../components/ui.jsx";

export interface Session {
  userId: string;
  fullName: string;
  role: string;
  lang: "bn" | "en";
}

interface Ctx {
  session: Session | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  setLang: (l: "bn" | "en") => void;
}

const SessionCtx = createContext<Ctx>({ session: null, loading: true, refresh: async () => {}, logout: () => {}, setLang: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  async function refresh() {
    if (!localStorage.getItem("ab_at")) {
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api<{ id: string; fullName: string; role: string; langPref: "bn" | "en" }>("GET", "/auth/me");
      setSession({ userId: me.id, fullName: me.fullName, role: me.role, lang: me.langPref });
      identify(me.id);
    } catch {
      clearTokens();
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Final-401 hook from the http layer: clear session, notify, send to /login
  // keeping the current path so login can return the user.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearTokens();
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
    clearTokens();
    identify("");
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

  return <SessionCtx.Provider value={{ session, loading, refresh, logout, setLang }}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  return useContext(SessionCtx);
}
