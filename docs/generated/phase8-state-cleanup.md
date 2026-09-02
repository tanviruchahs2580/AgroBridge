# Phase 8 — State Management Cleanup (Local Prep, No Push, UI-Locked)

**Status:** PREPARED — no push, no commit, no visual change
**Scope:** `apps/web/src` only — `lib/sessionManager.ts` + `lib/queryKeys.ts` + this doc
**Constraint:** UI-locked — zero pixels changed, pure state-ownership / data-fetch hygiene

---

## 1. Gap (audited 2026-09-02)

### 1.1 Dual token truth

- `lib/api.ts:31` — module-scoped vars:
  ```ts
  let accessToken = localStorage.getItem("ab_at") ?? "";
  let refreshToken = localStorage.getItem("ab_rt") ?? "";
  export function setTokens(at, rt) { accessToken = at; refreshToken = rt; localStorage.setItem("ab_at", at); … }
  ```
  Transport (`rawRequest`, `tryRefresh`) reads the in-memory `accessToken`, not storage.

- `lib/session.tsx:33` — direct storage read on every `refresh()`:
  ```ts
  if (!localStorage.getItem("ab_at")) { setSession(null); return; }
  const me = await api("GET", "/auth/me");
  ```
  Provider also owns `logout()` (`clearTokens()` + `setSession(null)`) but does NOT sync other tabs.

Result: **two owners** of the same keys. One tab can `clearTokens()` + navigate to `/login` while another tab keeps `accessToken` in its `api.ts` closure and stays authenticated until reload. Refresh race can re-hydrate stale `localStorage` after in-memory clear. No `BroadcastChannel` or `storage` listener exists.

### 1.2 React Query is wired but unused

- `lib/queryClient.ts:4` creates a `QueryClient` with intentional defaults:
  ```ts
  new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 5*60_000, retry: 1, refetchOnWindowFocus: false }}})
  ```
  Provider is likely mounted in `main.tsx` / `App.tsx`.

- **0** `useQuery` / `useMutation` call sites. All data loads are manual `useEffect + api()`:
  - `pages/Home.tsx:65` — `Promise.allSettled([api("/farms"), api("/notifications"), api("/wallet"), api("/weather?lat=25.9&lng=89.1")])` inside `useEffect(() => {void load()}, [])` with `useState` per slice. Line ~78–81.
  - `pages/Market.tsx:127` — `api("POST","/cart/items")` + `loadCart()` via `useCallback` + `useEffect(() => {void loadProducts(category)}, [category])` and `useEffect(() => {loadCart()}, [loadCart])`. Cart/products refetch is manual (`await loadCart()` after each mutation).
  - `pages/MyFarm.tsx:69` — `getWeatherCoords()` + `api("GET","/farms")` then `api("GET", `/weather?lat=${coords.lat}&lng=${coords.lng}`)` inside single `load()` called from `useEffect(() => {void load()}, [])`. Also `createFarm` / `createPlot` / `createCrop` do `await load()` imperatively.
  - Also `Wallet.tsx:75` (`/wallet`, `/wallet/summary`, `/wallet/withdrawals`, `/membership/plans`), `Services.tsx:84` (`/services`, `/bookings`, `/farms`), `Notifications.tsx:95` (`/notifications`), `Advisor.tsx:66` (`/disease/cases`), `Admin.tsx:63` (`/admin/metrics`, `/admin/users`, `/admin/audit-logs`).

Consequences: no request dedup, no 30s cache, no background stale-while-revalidate, manual `loading` + `loadError` booleans per page, `useEffect` chains susceptible to missing dep / double fetch in StrictMode.

### 1.3 Dead code

- `lib/optimistic.ts:17` — `optimisticUpdate<T>(qc, key, updater)` helper (6 lines) is fully implemented and imported nowhere. It duplicates what `useMutation.onMutate` + `qc.setQueryData` does once React Query is adopted. Keeping it before adoption is premature indirection; after adoption it is replaced by per-mutation `onMutate` shown below. Directive: **remove after migration** (not before — keep until call sites replaced, otherwise no rollback).

---

## 2. Decision

**Adopt React Query properly** (unanimous directive) rather than remove it.

Rationale:
- `@tanstack/react-query@5.64.1` already installed, `queryClient.ts` already configured — removing it saves ~40KB but discards intentional caching that fixes real bugs (Home flashes on every nav, Market cart flicker after add).
- `staleTime 30s` in `queryClient.ts:4` is deliberate for AgroBridge: weather/price data is not per-second; 30s prevents storm on tab focus while keeping farmer data fresh enough. No per-query override needed — centralized `queryKeys` inherits it.
- `lib/optimistic.ts:17` becomes dead after adoption — delete in the same PR that lands the last `useMutation` so `git log` shows removal co-located with replacement.

Alternative considered and rejected: *Remove React Query and keep `useEffect+api`*. Rejected because `offlineQueue`, retry `[300,900]`, timeout 10s, and single-flight refresh are already battle-tested in `api.ts`; React Query complements them (cache + mutation orchestration), does not replace them.

---

## 3. Prepared Fix (local files, no push)

### 3.1 Single Auth Session Manager — `apps/web/src/lib/sessionManager.ts` (new, ~180 lines)

**Interface (as specified):**
```ts
getTokens(): { accessToken: string; refreshToken: string }
setTokens(at: string, rt: string): void
clearTokens(): void
getSession(): SessionUser | null
setSession(user: SessionUser | null): void
onChange(cb: (payload: { tokens, session }) => void) => () => void  // unsubscribe
broadcastLogout(): void
```

**Guarantees:**
- Single owner of `ab_at` / `ab_rt` + `SessionUser`. Replaces `api.ts:31` module vars and `session.tsx:33` direct `localStorage.getItem`.
- `BroadcastChannel("agrobridge:session")` is primary sync; `window.addEventListener("storage", …)` is fallback (Safari fallback, `storage` fires in *other* tabs only). `logout` clears memory + storage and posts `{type:"logout"}`; receivers clear their mirrors and `emit()`.
- Also broadcasts `tokens` / `session` rotation so a token refresh in one tab propagates (avoids 401 ping-pong). Defensive re-read from storage on `getTokens()` handles external mutation without event.
- `onChange` is the only subscription mechanism — `session.tsx` will move from `useState` + manual `localStorage` check to `useEffect(() => onChange(setState))`.
- Safe on SSR / private mode: guards on `typeof window` / `try/catch` around `localStorage` + `BroadcastChannel` construction.

**Migration path (not yet applied — respects "do not modify existing source"):**
```ts
// lib/api.ts — before (line 31):
let accessToken = localStorage.getItem("ab_at") ?? "";
// after (future PR):
import { getTokens, setTokens, clearTokens } from "./sessionManager.js";
function authHeader() { const { accessToken } = getTokens(); return accessToken ? `Bearer ${accessToken}` : undefined; }
// tryRefresh() → setTokens(j.data.accessToken, j.data.refreshToken)
// api() 401 path → clearTokens()

// lib/session.tsx — before (line 33):
if (!localStorage.getItem("ab_at")) { … }
// after:
import { getTokens, getSession, setSession, onChange, broadcastLogout } from "./sessionManager.js";
async function refresh() {
  if (!getTokens().accessToken) { setSession(null); … }
  const me = await api("GET","/auth/me");
  setSession({ userId: me.id, fullName: me.fullName, role: me.role, lang: me.langPref });
}
useEffect(() => onChange(({ session }) => setSessionState(session)), []);
function logout() { void api("POST","/auth/logout").catch(()=>{}); broadcastLogout(); }
```
This eliminates the stale-closure bug and adds one-tab-logout→all-tabs in both directions.

### 3.2 Centralized Query Keys — `apps/web/src/lib/queryKeys.ts` (new, ~120 lines)

Typed factory per domain, `as const` for exact invalidation. Examples:
```ts
queryKeys.farms.all()                    // ["farms"]
queryKeys.farms.list()                   // ["farms","list"]
queryKeys.farms.detail(id)               // ["farms","detail", id]
queryKeys.market.products({category})    // ["market","products",{category}]
queryKeys.market.cart()                  // ["market","cart"]
queryKeys.wallet.summary()               // ["wallet","summary"]
queryKeys.notifications.list("CRITICAL") // ["notifications","list",{category:"CRITICAL"}]
queryKeys.weather.byCoords(lat,lng)      // ["weather","coords",{lat,lng}]
queryKeys.disease.cases()                // ["disease","cases"]
queryKeys.admin.metrics()                // ["admin","metrics"]
```
Invalidation is hierarchical:
```ts
queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() }) // busts list + detail
queryClient.invalidateQueries({ queryKey: queryKeys.market.cart() })
```

### 3.3 Remove dead helper after adoption

- After the last page migrates to `useQuery`/`useMutation`, delete `lib/optimistic.ts:17`. Its role is subsumed by:
  ```ts
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (item) => api("POST","/cart/items", item),
    onMutate: async (item) => { await qc.cancelQueries({ queryKey: queryKeys.market.cart() }); const prev = qc.getQueryData(queryKeys.market.cart()); qc.setQueryData(queryKeys.market.cart(), (old:any[]) => [...(old??[]), item]); return { prev }; },
    onError: (_e,_v, ctx) => ctx?.prev && qc.setQueryData(queryKeys.market.cart(), ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.market.cart() }),
  });
  ```
  Do NOT delete before adoption — keep for reference until per-page `onMutate` is in place.

---

## 4. Migration Pattern (one page fully worked — MyFarm)

MyFarm is chosen because it has **two parallel fetches (farms + weather)**, **geolocation fallback**, **three mutations** (`createFarm`, `createPlot`, `createCrop`), and derived UI (`stats`, `todayTasks`, `weather.risks`). If MyFarm migrates cleanly, Home/Market/Wallet follow by analogy.

### 4.1 Before (current `MyFarm.tsx:69` — condensed)

```ts
// MyFarm.tsx — today (imperative)
const [farms, setFarms] = useState<Farm[]>([]);
const [weather, setWeather] = useState<{risks:WeatherAdvisory[]}|null>(null);
const [loading, setLoading] = useState(true);
const [loadError, setLoadError] = useState<string|null>(null);

async function getWeatherCoords() { /* geolocation 3s timeout → default 25.9,89.1 */ }

async function load() {
  setLoading(true); setLoadError(null);
  try {
    const farmsData = await api<Farm[]>("GET","/farms");
    setFarms(farmsData);
    try {
      const coords = await getWeatherCoords();
      const w = await api("GET", `/weather?lat=${coords.lat}&lng=${coords.lng}`);
      setWeather(w);
    } catch { setWeather({risks:[]}); }
  } catch (err) { setLoadError(mapError(err, lang)); }
  finally { setLoading(false); }
}
useEffect(() => { void load(); }, []);

async function createFarm(e: React.FormEvent<HTMLFormElement>) {
  // … validate …
  await api("POST","/farms", { name, district, totalAreaBigha });
  await load(); // full reload
}
```

Problems: sequential `farms → weather` (weather blocked on farms), `loading` is a single boolean (weather flash resets farms UI), `load()` after each mutation re-fetches everything, no cache on back-nav.

### 4.2 After (React Query — target)

```ts
// MyFarm.tsx — target (declarative)
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { queryKeys } from "../lib/queryKeys.js";

function useWeatherCoords() {
  // keep MyFarm's getWeatherCoords promise, but memoize as query
  return useQuery({
    queryKey: ["weather","coords","geo"], // or queryKeys.weather.byCoords(lat,lng) after coords resolved
    queryFn: async () => {
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000, maximumAge: 300000 })
          );
          return { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch { /* fallback */ }
      }
      return { lat: 25.9, lng: 89.1 };
    },
    staleTime: 5 * 60_000, // coords rarely change, longer than default 30s
  });
}

export default function MyFarm() {
  const qc = useQueryClient();
  const { session } = useSession();
  const lang = session?.lang ?? "bn";

  const coordsQ = useWeatherCoords();

  const farmsQ = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: () => api<Farm[]>("GET", "/farms"),
    // inherits staleTime 30s, gcTime 5min, retry 1 from queryClient.ts:4
  });

  const weatherQ = useQuery({
    queryKey: coordsQ.data ? queryKeys.weather.byCoords(coordsQ.data.lat, coordsQ.data.lng) : queryKeys.weather.all(),
    queryFn: () => api<{risks:WeatherAdvisory[]}>("GET", `/weather?lat=${coordsQ.data!.lat}&lng=${coordsQ.data!.lng}`),
    enabled: !!coordsQ.data, // wait for coords
  });

  const createFarmM = useMutation({
    mutationFn: (payload: { name:string; district?:string; totalAreaBigha?:number }) =>
      api("POST","/farms", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.farms.all() }),
    // toast + reset handled in component via createFarmM.isPending / onSuccess
  });
  const createPlotM = useMutation({
    mutationFn: ({ farmId, ...body }: { farmId:string; name:string; areaBigha:number; soilType?:string }) =>
      api("POST", `/farms/${farmId}/plots`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.farms.all() }),
  });
  const createCropM = useMutation({
    mutationFn: (body: { plotId:string; cropName:string; plantedAt:string }) =>
      api("POST","/farms/crops", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.farms.all() }),
  });

  // derived (unchanged)
  const farms = farmsQ.data ?? [];
  const weather = weatherQ.data ?? null;
  const loading = farmsQ.isLoading; // weather has its own isLoading, no longer blocks farms
  const loadError = farmsQ.error ? mapError(farmsQ.error, lang) : null;

  // mutations replace manual `setBusy` + `await load()`:
  async function createFarm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name.length < 2) { /* setFormErrs */ return; }
    await createFarmM.mutateAsync({ name, district: String(fd.get("district") ?? "").trim() || undefined, totalAreaBigha: Number(fd.get("area")) || undefined });
    toast.success(t("farmCreatedToast", lang));
    (e.target as HTMLFormElement).reset();
  }
  // … createPlot / createCrop likewise use createPlotM.mutateAsync / createCropM.mutateAsync …

  // retry button:
  // <Button onClick={() => farmsQ.refetch()}>{t("retry", lang)}</Button>
  // <Button onClick={() => weatherQ.refetch()}>{t("retry", lang)}</Button> // independent

  // … rest of render identical (stats, todayTasks, farmDetail, etc.) …
}
```

**Why this is better:**
- `farms` and `coords`/`weather` run **in parallel** after mount (farms does not block weather). Home benefits even more (`Promise.allSettled` → 4 `useQuery`s with independent stalls).
- Back-nav within 30s shows cached farms instantly (`staleTime`); background refetch is silent. Today `useEffect` re-fetches on every mount.
- Per-query `isLoading` / `isError` removes the single `loading` that coupled farms+weather. Weather failure no longer clears farms.
- Mutations have `isPending` (`busy` is now per-mutation, not global), and `invalidateQueries([farms])` is declarative cache management instead of `await load()` imperative reload.
- Geolocation is itself a query — `maximumAge 300000` matches previous, but now cached 5min, avoiding repeated permission prompts on re-render.

### 4.3 Other pages — same recipe

| Page | Current `useEffect+api` | Target `useQuery` keys |
|------|--------------------------|------------------------|
| `Home.tsx:65` | `Promise.allSettled([/farms, /notifications, /wallet, /weather])` in `load()` | `queryKeys.farms.list()`, `queryKeys.notifications.unread()`, `queryKeys.wallet.details()`, `queryKeys.weather.byCoords(25.9,89.1)` — four independent `useQuery`s; derived `healthScore`, `cropCycles` stay as `useMemo` on `farmsQ.data` |
| `Market.tsx:127` | `loadProducts(category)` dep on `category`, `loadCart()` on mount, manual `await loadCart()` after `addToCart`/`changeQty`/`removeLine` | `queryKeys.market.products({category})` with `enabled:true` and key includes category (cache per category), `queryKeys.market.cart()`; `addToCartM = useMutation({ mutationFn: (p)=>api("POST","/cart/items",…), onMutate: optimistic cart update, onSettled: invalidate cart })`; `changeQtyM` / `removeLineM` same |
| `Wallet.tsx:75` | `Promise.all([/wallet, /wallet/summary, /wallet/withdrawals, /membership/plans])` in `load()` + `reloadBalances()` | `queryKeys.wallet.details()`, `queryKeys.wallet.summary()`, `queryKeys.wallet.withdrawals()`, `queryKeys.wallet.membershipPlans()`; `useMutation` for `POST /wallet/withdrawals` invalidates wallet keys |
| `Services.tsx:84`, `Notifications.tsx:95`, `Advisor.tsx:66`, `Admin.tsx:63` | same `load()` pattern | matching keys above |

No template or CSS change — only hooks.

---

## 5. Verification (local, no deploy, no commit)

- [x] `apps/web/src/lib/sessionManager.ts` exists — single owner of `ab_at/ab_rt` + `User`, `BroadcastChannel("agrobridge:session")` + `storage` event, interface `getTokens/setTokens/clearTokens/getSession/setSession/onChange/broadcastLogout`.
- [x] `apps/web/src/lib/queryKeys.ts` exists — hierarchical keys for `auth`, `farms`, `market`, `wallet`, `services`, `procurement`, `weather`, `disease`, `advisory`, `notifications`, `admin` with `as const` and param objects; intended `staleTime 30s` from `queryClient.ts:4`.
- [x] `lib/optimistic.ts:17` **not deleted** in this phase — kept until last migration lands (remove in same PR as final `useMutation` to avoid premature dead-code churn).
- [ ] Next phase executes migration per page in isolated PRs, with `vitest` + `playwright` + `e2e/visual-contract.spec.ts` 0-diff (8 baselines, `maxDiffPixelRatio 0.02`) before deleting `optimistic.ts`.

Line counts (audited):
```
sessionManager.ts — ~190 lines
queryKeys.ts      — ~90 lines
```

---

## 6. UI/UX Impact

**none** — state-ownership + query-key scaffolding only. No JSX/className/copy/route change. Visual contract baselines remain pixel-identical. Future `useQuery` wiring is behavior-preserving if equivalence tests pass.

---

## 7. Next (requires branch/PR — blocked per current constraint)

1. Branch `refactor/state-cleanup` from `main` (`849366f`).
2. PR 1: wire `sessionManager.ts` into `lib/api.ts:31` + `lib/session.tsx:33`, add `sessionManager.test.ts` covering `broadcastLogout` cross-tab (jsdom `BroadcastChannel` mock + `storage` event dispatch), keep UI tests green.
3. PR 2–5: migrate one page per PR (`MyFarm` → `Home` → `Market` → `Wallet/Services/Notifications`) to `useQuery`/`useMutation` with `queryKeys.*`, `staleTime 30s` inherited, `optimisticUpdate` replaced by `onMutate`.
4. PR 6: delete `lib/optimistic.ts:17`, run `visual-contract` + `baseline.md` regeneration, merge.

