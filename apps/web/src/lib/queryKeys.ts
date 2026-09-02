// Centralized React Query keys (Phase 8)
// Purpose: replace scattered `useEffect + api()` string paths with typed,
// hierarchical keys that enable cache invalidation, dedup, and
// `staleTime: 30s` (queryClient.ts:4) semantics.
// To be used when migrating:
//   Home.tsx:65   farms + notifications + wallet + weather
//   Market.tsx:127 cart + products
//   MyFarm.tsx:69  farms + weather
//   Wallet.tsx:75  wallet / summary / withdrawals / plans
//   etc. — every `useEffect` that calls `api("GET", "...")`.
//
// Convention: TanStack `queryKey` is a readonly tuple. Factories return
// `as const` so `invalidateQueries({ queryKey: queryKeys.farms.all() })`
// correctly matches descendants. Params are embedded as objects for
// structural sharing.

export const queryKeys = {
  // ── Auth ───────────────────────────────────────────────────────────────
  auth: {
    all: () => ["auth"] as const,
    me: () => ["auth", "me"] as const,
  },

  // ── Farms / Plots / CropCycles ─────────────────────────────────────────
  farms: {
    all: () => ["farms"] as const,
    list: () => [...queryKeys.farms.all(), "list"] as const,
    detail: (farmId: string) => [...queryKeys.farms.all(), "detail", farmId] as const,
    plots: (farmId: string) => [...queryKeys.farms.all(), farmId, "plots"] as const,
    // weather is farm/geo-dependent but kept separate for gc tuning
  },

  // ── Market / Catalog / Cart / Orders ───────────────────────────────────
  market: {
    all: () => ["market"] as const,
    products: (params?: { category?: string; pageSize?: number }) =>
      [...queryKeys.market.all(), "products", params ?? {}] as const,
    productDetail: (productId: string) => [...queryKeys.market.all(), "product", productId] as const,
    cart: () => [...queryKeys.market.all(), "cart"] as const,
    orders: () => [...queryKeys.market.all(), "orders"] as const,
    orderDetail: (orderId: string) => [...queryKeys.market.all(), "order", orderId] as const,
  },

  // ── Wallet / Membership ────────────────────────────────────────────────
  wallet: {
    all: () => ["wallet"] as const,
    details: () => [...queryKeys.wallet.all(), "details"] as const,
    summary: () => [...queryKeys.wallet.all(), "summary"] as const,
    transactions: () => [...queryKeys.wallet.all(), "transactions"] as const,
    withdrawals: () => [...queryKeys.wallet.all(), "withdrawals"] as const,
    membershipPlans: () => [...queryKeys.wallet.all(), "membership", "plans"] as const,
    membership: () => [...queryKeys.wallet.all(), "membership"] as const,
  },

  // ── Services & Bookings ────────────────────────────────────────────────
  services: {
    all: () => ["services"] as const,
    list: () => [...queryKeys.services.all(), "list"] as const,
    detail: (serviceId: string) => [...queryKeys.services.all(), "detail", serviceId] as const,
    bookings: () => [...queryKeys.services.all(), "bookings"] as const,
    bookingDetail: (bookingId: string) => [...queryKeys.services.all(), "booking", bookingId] as const,
  },

  // ── Procurement / SellCrop ─────────────────────────────────────────────
  procurement: {
    all: () => ["procurement"] as const,
    offers: () => [...queryKeys.procurement.all(), "offers"] as const,
    orders: () => [...queryKeys.procurement.all(), "orders"] as const,
  },

  // ── Weather / Advisory / Disease ───────────────────────────────────────
  weather: {
    all: () => ["weather"] as const,
    byCoords: (lat: number, lng: number) => [...queryKeys.weather.all(), "coords", { lat, lng }] as const,
    // Home uses fixed fallback 25.9,89.1; MyFarm uses geolocated coords
    risks: (lat: number, lng: number) => [...queryKeys.weather.all(), "risks", { lat, lng }] as const,
  },
  disease: {
    all: () => ["disease"] as const,
    cases: () => [...queryKeys.disease.all(), "cases"] as const,
    caseDetail: (caseId: string) => [...queryKeys.disease.all(), "case", caseId] as const,
  },
  advisory: {
    all: () => ["advisory"] as const,
    // advisory is POST-only (question+lang) — keyed for mutation cache if needed
    history: () => [...queryKeys.advisory.all(), "history"] as const,
  },

  // ── Notifications ──────────────────────────────────────────────────────
  notifications: {
    all: () => ["notifications"] as const,
    list: (category?: string) => [...queryKeys.notifications.all(), "list", { category: category ?? "ALL" }] as const,
    unread: () => [...queryKeys.notifications.all(), "unread"] as const,
    preferences: () => [...queryKeys.notifications.all(), "preferences"] as const,
  },

  // ── Admin ──────────────────────────────────────────────────────────────
  admin: {
    all: () => ["admin"] as const,
    metrics: () => [...queryKeys.admin.all(), "metrics"] as const,
    users: (params?: { pageSize?: number }) => [...queryKeys.admin.all(), "users", params ?? {}] as const,
    auditLogs: (params?: { pageSize?: number }) => [...queryKeys.admin.all(), "auditLogs", params ?? {}] as const,
    withdrawals: (status?: string) => [...queryKeys.admin.all(), "withdrawals", { status: status ?? "PENDING" }] as const,
    analytics: () => [...queryKeys.admin.all(), "analytics", "summary"] as const,
  },
} as const;

// ── Typed helpers ──────────────────────────────────────────────────────────
// Useful for generic invalidation:
//   queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() })
// invalidates ["farms"], ["farms","list"], ["farms","detail", id], etc.
//   queryClient.invalidateQueries({ queryKey: queryKeys.market.cart() })
//   queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() })
//
// Migration note:
//   Before (Home.tsx:65):
//     const [weather, setWeather] = useState(null);
//     useEffect(() => { api("GET","/weather?lat=25.9&lng=89.1").then(setWeather) }, []);
//   After:
//     const { data: weather } = useQuery({
//       queryKey: queryKeys.weather.byCoords(25.9, 89.1),
//       queryFn: () => api("GET","/weather?lat=25.9&lng=89.1"),
//     });
//   Same for MyFarm farms + weather, Market cart + products, Wallet summary etc.
//   Keeps staleTime 30s + gcTime 5min from queryClient.ts:4 without per-query override.
