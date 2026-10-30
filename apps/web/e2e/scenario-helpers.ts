import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Shared helpers for the scenario-acceptance specs. Login/registration go
 * through the UI (that is the acceptance surface); the API helpers exist for
 * setup, cleanup and the explicit negative-security checks, as the acceptance
 * protocol allows.
 */

export const DEMO = {
  superAdmin: { phone: "01700000000", password: "Demo@1234" },
  admin: { phone: "01700000001", password: "Demo@1234" },
  farmer: { phone: "01700000002", password: "Demo@1234" },
  dealer: { phone: "01700000003", password: "Demo@1234" },
  procurement: { phone: "01700000004", password: "Demo@1234" },
} as const;

export type Cred = { phone: string; password: string };

export async function login(page: Page, cred: Cred = DEMO.farmer) {
  await page.goto("/login");
  await page.fill("#phone", cred.phone);
  await page.fill("#password", cred.password);
  await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20_000 });
  // Mobile viewport: the bottom nav is visible; desktop: the sidebar. Assert the
  // shell that is actually shown at this viewport.
  await expect(
    page.locator('[data-testid="bottom-nav"]:visible, [data-testid="sidebar-nav"]:visible').first()
  ).toBeVisible({ timeout: 10_000 });
}

export async function logout(page: Page) {
  await page.locator("header button", { hasText: /লগআউট|Logout/i }).first().click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
}

export async function apiLogin(request: APIRequestContext, cred: Cred = DEMO.farmer) {
  const res = await request.post("/api/v1/auth/login", { data: { phone: cred.phone, password: cred.password } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; role: string; fullName: string };
  };
}

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function api(
  request: APIRequestContext,
  method: "get" | "post" | "patch" | "delete",
  path: string,
  token?: string,
  data?: unknown
) {
  return request[method](`/api/v1${path}`, {
    ...(token ? { headers: authHeaders(token) } : {}),
    ...(data !== undefined ? { data } : {}),
  });
}

let counter = Date.now() % 10_000_000;
/** Unique synthetic BD mobile number (01 9 xxxxxxxx). */
export function uniquePhone(): string {
  counter += 1;
  return `019${String(counter).padStart(8, "0")}`;
}

export async function registerByApi(
  request: APIRequestContext,
  opts: { phone?: string; fullName?: string; password?: string } = {}
) {
  const phone = opts.phone ?? uniquePhone();
  const res = await request.post("/api/v1/auth/register", {
    data: {
      fullName: opts.fullName ?? "E2E সিন্থেটিক কৃষক",
      phone,
      password: opts.password ?? "Demo@1234",
      langPref: "bn",
      consent: true,
    },
  });
  expect([200, 201], await res.text()).toContain(res.status());
  return {
    phone,
    data: (await res.json()).data as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; fullName: string; role: string };
    },
  };
}

/** Current farmer's farm list via API (fixture inspection, no UI assertions here). */
export async function farmerFarms(request: APIRequestContext, token: string) {
  const res = await api(request, "get", "/farms", token);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data as {
    id: string;
    name: string;
    district: string | null;
    areaBigha: number | null;
    plots: { id: string; name: string }[];
  }[];
}

export async function createFarmByApi(
  request: APIRequestContext,
  token: string,
  body: { name: string; district?: string; areaBigha?: number }
) {
  const res = await api(request, "post", "/farms", token, body);
  expect([200, 201], await res.text()).toContain(res.status());
  return (await res.json()).data as { id: string; name: string };
}
