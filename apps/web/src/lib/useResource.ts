import { useCallback, useEffect, useRef, useState } from "react";
import { mapError } from "./errors-ui";
import { useSession } from "./session";

/**
 * The app's data layer: one hook owns loading, error, refetch and staleness, so
 * features stop hand-rolling it.
 *
 * Why it exists: ten screens each carried their own `loading` / `loadError` /
 * `load()` triple plus retry UI, and mutations refetched by calling those `load()`
 * functions by hand — 23 call sites. Two consequences were visible in the code:
 * a forgotten refetch leaves stale data on screen, and a page that fetches several
 * independent endpoints blanks completely when any one of them fails.
 *
 * The pattern:
 *   const wallet = useResource("wallet", () => api<WalletData>("GET", "/wallet"));
 *   …
 *   invalidate("wallet");           // after a mutation — every subscriber refetches
 * or, from inside a component:
 *   const invalidateResource = useInvalidation();
 *
 * `key` is a resource *family*, not a URL: everything that changes together shares
 * one key so a single `invalidate` covers them. Independent blocks on a page get
 * independent keys, which is what makes partial failure survivable — one failing
 * panel no longer takes the page with it.
 *
 * Deliberately not a query library: no cache persistence, no deduplication window,
 * no background refetching. At this app's size those features would be unused
 * surface area; what was actually missing was ownership and cancellation.
 */

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

/** Notifies every mounted resource with this key to refetch. Callable outside React. */
export function invalidate(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const listener of set) listener();
}

/** React-friendly form for components that mutate data. */
export function useInvalidation(): (key: string) => void {
  return useCallback((key: string) => invalidate(key), []);
}

function subscribe(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

export interface Resource<T> {
  data: T | null;
  /** True only until the first result (data or error) arrives. */
  loading: boolean;
  /** True while a later reload runs — existing data stays on screen. */
  refreshing: boolean;
  /** Localized, already-mapped failure text; null when the last load succeeded. */
  error: string | null;
  reload: () => Promise<void>;
  /** Local update for optimistic UI, without a round trip. */
  setData: (next: T) => void;
}

export function useResource<T>(key: string, fetcher: () => Promise<T>, deps: unknown[] = []): Resource<T> {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A result (data or error) has arrived at least once. */
  const [settled, setSettled] = useState(false);
  /** Requests currently in flight; distinguishes a first load from a refresh. */
  const [inFlight, setInFlight] = useState(0);

  // Latest fetcher without making it a dependency: callers pass inline closures,
  // and depending on them would refetch on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const langRef = useRef(lang);
  langRef.current = lang;

  // Only the newest request may write state: a reload that started before an
  // invalidate must not overwrite the newer result (the classic stale-response race).
  const requestId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    // The setup half matters: React StrictMode (dev) mounts, cleans up and mounts
    // again on the SAME instance, so a flag that is only ever set false would make
    // every subsequent result look like it arrived after unmount — the page then
    // renders skeletons forever in development while tests and production builds
    // (which do not double-invoke effects) pass. Caught by a StrictMode test.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const id = ++requestId.current;
    setInFlight((n) => n + 1);
    try {
      const next = await fetcherRef.current();
      if (!mounted.current || id !== requestId.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (!mounted.current || id !== requestId.current) return;
      setError(mapError(e, langRef.current));
    } finally {
      if (mounted.current) {
        setInFlight((n) => Math.max(0, n - 1));
        if (id === requestId.current) setSettled(true);
      }
    }
  }, []);

  const reload = useCallback(() => run(), [run]);

  // Subscribe to invalidation for this key.
  useEffect(() => subscribe(key, () => void run()), [key, run]);

  // Initial load and dependency changes.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run, ...deps]);

  return {
    data,
    loading: !settled,
    refreshing: settled && inFlight > 0,
    error,
    reload,
    setData,
  };
}
