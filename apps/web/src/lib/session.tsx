import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api.js";

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

  async function refresh() {
    if (!localStorage.getItem("ab_at")) {
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api<{ id: string; fullName: string; role: string; langPref: "bn" | "en" }>("GET", "/auth/me");
      setSession({ userId: me.id, fullName: me.fullName, role: me.role, lang: me.langPref });
    } catch {
      localStorage.removeItem("ab_at");
      localStorage.removeItem("ab_rt");
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function logout() {
    void api("POST", "/auth/logout", {}).catch(() => undefined);
    localStorage.removeItem("ab_at");
    localStorage.removeItem("ab_rt");
    setSession(null);
  }

  async function setLang(l: "bn" | "en") {
    setSession((s) => (s ? { ...s, lang: l } : s));
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
