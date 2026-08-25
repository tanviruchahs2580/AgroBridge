// API client with token storage + refresh handling.
// Base URL is build-time configurable so the same bundle works behind nginx
// proxy ("/api/v1") or as a Capacitor APK / cross-origin PWA ("https://api…").
const BASE = ((import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "/api/v1").replace(/\/+$/, "");

export interface AuthUser {
  id: string;
  fullName: string;
  role: string;
  langPref: "bn" | "en";
}

let accessToken = localStorage.getItem("ab_at") ?? "";
let refreshToken = localStorage.getItem("ab_rt") ?? "";

export function setTokens(at: string, rt: string) {
  accessToken = at;
  refreshToken = rt;
  localStorage.setItem("ab_at", at);
  localStorage.setItem("ab_rt", rt);
}

export function clearTokens() {
  accessToken = "";
  refreshToken = "";
  localStorage.removeItem("ab_at");
  localStorage.removeItem("ab_rt");
}

export function hasToken() {
  return Boolean(accessToken);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function rawRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  return res;
}

/** Single-flight refresh to avoid stampedes on 401. */
let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const j = await res.json();
      setTokens(j.data.accessToken, j.data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  let res = await rawRequest(method, path, body);
  if (res.status === 401 && retry && refreshToken) {
    if (await tryRefresh()) {
      res = await rawRequest(method, path, body);
    }
  }

  const json = await res.json().catch(() => ({ ok: false, error: { code: "BAD_RESPONSE", message: "Malformed server response" } }));

  if (!res.ok || !json.ok) {
    const err = json?.error ?? {};
    if (res.status === 401 && !retry) clearTokens();
    throw new ApiError(res.status, err.code ?? "UNKNOWN", err.message ?? "সমস্যা হয়েছে / Something went wrong", err.details);
  }
  return json.data as T;
}
