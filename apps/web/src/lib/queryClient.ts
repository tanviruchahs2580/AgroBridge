import { QueryClient } from "@tanstack/react-query";

/** Shared QueryClient (Step 54) — 30s stale, 5min gc, single retry with backoff. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
